/**
 * Anthropicプロバイダアダプタ
 * Anthropic Messages APIへのリクエスト送信とレスポンス正規化を担当
 */
import type { UnifiedResponse, HealthStatus } from "@/types/response.js";
import type { ModelEntry } from "@/config/types.js";
import { createAbortSignal } from "@/providers/base.js";
import type { ProviderAdapter, GenerateRequest } from "@/providers/base.js";

/** Anthropic Messages レスポンス型 */
interface AnthropicMessageResponse {
  content: Array<{
    type: string;
    text: string;
  }>;
  model: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

/** Anthropic Messages リクエストボディ型 */
interface AnthropicMessageRequest {
  model: string;
  messages: Array<{ role: string; content: string }>;
  max_tokens: number;
  system?: string;
  temperature?: number;
}

export class AnthropicAdapter implements ProviderAdapter {
  readonly provider = "anthropic";

  async generate(request: GenerateRequest): Promise<UnifiedResponse> {
    const { prompt, model_name, endpoint, auth, options, timeout_ms } = request;

    const body: AnthropicMessageRequest = {
      model: model_name,
      messages: [{ role: "user", content: prompt }],
      max_tokens: options?.max_tokens ?? 4096,
    };

    // Anthropicではsystem_promptはトップレベルのsystemフィールドに設定
    if (options?.system_prompt) {
      body.system = options.system_prompt;
    }

    if (options?.temperature !== undefined) {
      body.temperature = options.temperature;
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
    };

    if (auth?.api_key) {
      headers["x-api-key"] = auth.api_key;
    }

    const signal = createAbortSignal(timeout_ms);

    let response: Response;
    try {
      response = await fetch(`${endpoint}/v1/messages`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal,
      });
    } catch (error: unknown) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(
          `Anthropic request timed out after ${timeout_ms}ms`
        );
      }
      throw new Error(
        `Anthropic network error: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      if (response.status === 401 || response.status === 403) {
        throw new Error(
          `Anthropic authentication error (${response.status}): ${errorBody || response.statusText}. Please verify your API key configuration.`
        );
      }
      throw new Error(
        `Anthropic API error (${response.status}): ${errorBody || response.statusText}`
      );
    }

    const data = (await response.json()) as AnthropicMessageResponse;

    const inputTokens = data.usage?.input_tokens;
    const outputTokens = data.usage?.output_tokens;

    return {
      text: data.content?.[0]?.text ?? "",
      model_id: data.model,
      provider: this.provider,
      usage: {
        prompt_tokens: inputTokens,
        completion_tokens: outputTokens,
        total_tokens:
          inputTokens !== undefined && outputTokens !== undefined
            ? inputTokens + outputTokens
            : undefined,
      },
    };
  }

  async healthCheck(entry: ModelEntry): Promise<HealthStatus> {
    const start = performance.now();

    try {
      const signal = createAbortSignal(entry.timeout_ms ?? 5000);

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
      };

      if (entry.auth?.api_key) {
        headers["x-api-key"] = entry.auth.api_key;
      }

      // Anthropicには専用のhealthエンドポイントがないため、
      // max_tokens: 1の最小リクエストで到達性を確認
      const body: AnthropicMessageRequest = {
        model: entry.model_name,
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 1,
      };

      const response = await fetch(`${entry.endpoint}/v1/messages`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
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
