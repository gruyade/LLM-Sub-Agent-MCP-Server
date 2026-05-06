/**
 * OpenAIプロバイダアダプタ
 * OpenAI Chat Completions APIへのリクエスト送信とレスポンス正規化を担当
 */
import type { UnifiedResponse, HealthStatus } from "@/types/response.js";
import type { ModelEntry } from "@/config/types.js";
import { createAbortSignal } from "@/providers/base.js";
import type { ProviderAdapter, GenerateRequest } from "@/providers/base.js";

/** OpenAI Chat Completions レスポンス型 */
interface OpenAIChatResponse {
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

/** OpenAI Chat Completions リクエストボディ型 */
interface OpenAIChatRequest {
  model: string;
  messages: Array<{ role: string; content: string }>;
  stream: false;
  temperature?: number;
  max_tokens?: number;
}

export class OpenAIAdapter implements ProviderAdapter {
  readonly provider = "openai";

  async generate(request: GenerateRequest): Promise<UnifiedResponse> {
    const { prompt, model_name, endpoint, auth, options, timeout_ms } = request;

    const messages: Array<{ role: string; content: string }> = [];

    // system_prompt指定時はsystemメッセージを先頭に追加
    if (options?.system_prompt) {
      messages.push({ role: "system", content: options.system_prompt });
    }

    messages.push({ role: "user", content: prompt });

    const body: OpenAIChatRequest = {
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
          `OpenAI request timed out after ${timeout_ms}ms`
        );
      }
      throw new Error(
        `OpenAI network error: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      if (response.status === 401 || response.status === 403) {
        throw new Error(
          `OpenAI authentication error (${response.status}): ${errorBody || response.statusText}. Please verify your API key configuration.`
        );
      }
      throw new Error(
        `OpenAI API error (${response.status}): ${errorBody || response.statusText}`
      );
    }

    const data = (await response.json()) as OpenAIChatResponse;

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
