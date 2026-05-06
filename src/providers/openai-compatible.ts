/**
 * OpenAI互換プロバイダアダプタ
 * LM Studio、vLLM、text-generation-webui等のOpenAI API互換ローカルLLMサーバー用
 * OpenAI Chat Completions APIフォーマットでリクエストを送信し、レスポンスを正規化
 * 認証はオプショナル（ローカルサーバーでは不要なケースが多い）
 */
import type { UnifiedResponse, HealthStatus } from "@/types/response.js";
import type { ModelEntry } from "@/config/types.js";
import { createAbortSignal } from "@/providers/base.js";
import type { ProviderAdapter, GenerateRequest } from "@/providers/base.js";

/** OpenAI互換 Chat Completions レスポンス型 */
interface OpenAICompatibleChatResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
  model: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

/** OpenAI互換 Chat Completions リクエストボディ型 */
interface OpenAICompatibleChatRequest {
  model: string;
  messages: Array<{ role: string; content: string }>;
  stream: false;
  temperature?: number;
  max_tokens?: number;
}

export class OpenAICompatibleAdapter implements ProviderAdapter {
  readonly provider = "openai-compatible";

  async generate(request: GenerateRequest): Promise<UnifiedResponse> {
    const { prompt, model_name, endpoint, auth, options, timeout_ms } = request;

    const messages: Array<{ role: string; content: string }> = [];

    if (options?.system_prompt) {
      messages.push({ role: "system", content: options.system_prompt });
    }

    messages.push({ role: "user", content: prompt });

    const body: OpenAICompatibleChatRequest = {
      model: model_name,
      messages,
      stream: false,
    };

    if (options?.temperature !== undefined) {
      body.temperature = options.temperature;
    }
    if (options?.max_tokens !== undefined) {
      body.max_tokens = options.max_tokens;
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    // 認証はオプショナル（ローカルサーバーでは不要な場合が多い）
    if (auth?.api_key) {
      headers["Authorization"] = `Bearer ${auth.api_key}`;
    }

    const signal = createAbortSignal(timeout_ms);

    let response: Response;
    try {
      response = await fetch(`${endpoint}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal,
      });
    } catch (error: unknown) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(
          `OpenAI-compatible server request timed out after ${timeout_ms}ms`
        );
      }
      throw new Error(
        `OpenAI-compatible server network error: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new Error(
        `OpenAI-compatible server API error (${response.status}): ${errorBody || response.statusText}`
      );
    }

    const data = (await response.json()) as OpenAICompatibleChatResponse;

    return {
      text: data.choices[0]?.message?.content ?? "",
      model_id: data.model,
      provider: this.provider,
      usage: {
        prompt_tokens: data.usage?.prompt_tokens,
        completion_tokens: data.usage?.completion_tokens,
        total_tokens: data.usage?.total_tokens,
      },
    };
  }

  async healthCheck(entry: ModelEntry): Promise<HealthStatus> {
    const start = performance.now();

    try {
      const signal = createAbortSignal(entry.timeout_ms ?? 5000);

      const headers: Record<string, string> = {};
      if (entry.auth?.api_key) {
        headers["Authorization"] = `Bearer ${entry.auth.api_key}`;
      }

      // OpenAI互換サーバーは /models エンドポイントをサポートしていることが多い
      const response = await fetch(`${entry.endpoint}/models`, {
        method: "GET",
        headers,
        signal,
      });

      const latency_ms = Math.round(performance.now() - start);

      if (!response.ok) {
        return {
          model_id: entry.id,
          provider: this.provider,
          reachable: false,
          latency_ms,
          error: `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      return {
        model_id: entry.id,
        provider: this.provider,
        reachable: true,
        latency_ms,
      };
    } catch (error: unknown) {
      const latency_ms = Math.round(performance.now() - start);
      const message =
        error instanceof Error ? error.message : String(error);

      return {
        model_id: entry.id,
        provider: this.provider,
        reachable: false,
        latency_ms,
        error: message,
      };
    }
  }
}
