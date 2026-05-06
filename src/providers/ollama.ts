/**
 * Ollamaプロバイダアダプタ
 * ローカルOllama HTTP APIへのリクエスト送信とレスポンス正規化を担当
 */
import type { UnifiedResponse, HealthStatus } from "@/types/response.js";
import type { ModelEntry } from "@/config/types.js";
import { createAbortSignal } from "@/providers/base.js";
import type { ProviderAdapter, GenerateRequest } from "@/providers/base.js";

/** Ollama /api/chat レスポンス型 */
interface OllamaChatResponse {
  message: {
    role: string;
    content: string;
  };
  model: string;
  eval_count?: number;
  prompt_eval_count?: number;
}

/** Ollama /api/chat リクエストボディ型 */
interface OllamaChatRequest {
  model: string;
  messages: Array<{ role: string; content: string }>;
  stream: false;
  options?: {
    temperature?: number;
    num_predict?: number;
  };
}

export class OllamaAdapter implements ProviderAdapter {
  readonly provider = "ollama";

  async generate(request: GenerateRequest): Promise<UnifiedResponse> {
    const { prompt, model_name, endpoint, options, timeout_ms } = request;

    const messages: Array<{ role: string; content: string }> = [];

    // system_prompt指定時はsystemメッセージを先頭に追加
    if (options?.system_prompt) {
      messages.push({ role: "system", content: options.system_prompt });
    }

    messages.push({ role: "user", content: prompt });

    const body: OllamaChatRequest = {
      model: model_name,
      messages,
      stream: false,
    };

    // optionsがある場合のみoptions付与
    if (options?.temperature !== undefined || options?.max_tokens !== undefined) {
      body.options = {};
      if (options.temperature !== undefined) {
        body.options.temperature = options.temperature;
      }
      if (options.max_tokens !== undefined) {
        body.options.num_predict = options.max_tokens;
      }
    }

    const signal = createAbortSignal(timeout_ms);

    let response: Response;
    try {
      response = await fetch(`${endpoint}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
    } catch (error: unknown) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(
          `Ollama request timed out after ${timeout_ms}ms`
        );
      }
      throw new Error(
        `Ollama network error: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new Error(
        `Ollama API error (${response.status}): ${errorBody || response.statusText}`
      );
    }

    const data = (await response.json()) as OllamaChatResponse;

    const completionTokens = data.eval_count;
    const promptTokens = data.prompt_eval_count;
    const totalTokens =
      promptTokens !== undefined && completionTokens !== undefined
        ? promptTokens + completionTokens
        : undefined;

    return {
      text: data.message.content,
      model_id: data.model,
      provider: this.provider,
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: totalTokens,
      },
    };
  }

  async healthCheck(entry: ModelEntry): Promise<HealthStatus> {
    const start = performance.now();

    try {
      const signal = createAbortSignal(entry.timeout_ms ?? 5000);
      const response = await fetch(`${entry.endpoint}/api/tags`, {
        method: "GET",
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
