/**
 * Geminiプロバイダアダプタ
 * Google Gemini APIへのリクエスト送信とレスポンス正規化を担当
 */
import type { UnifiedResponse, HealthStatus } from "@/types/response.js";
import type { ModelEntry } from "@/config/types.js";
import { createAbortSignal } from "@/providers/base.js";
import type { ProviderAdapter, GenerateRequest } from "@/providers/base.js";

/** Gemini generateContent レスポンス型 */
interface GeminiGenerateResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

/** Gemini generateContent リクエストボディ型 */
interface GeminiGenerateRequest {
  contents: Array<{
    parts: Array<{ text: string }>;
  }>;
  systemInstruction?: {
    parts: Array<{ text: string }>;
  };
  generationConfig?: {
    temperature?: number;
    maxOutputTokens?: number;
  };
}

export class GeminiAdapter implements ProviderAdapter {
  readonly provider = "gemini";

  async generate(request: GenerateRequest): Promise<UnifiedResponse> {
    const { prompt, model_name, endpoint, auth, options, timeout_ms } = request;

    const body: GeminiGenerateRequest = {
      contents: [{ parts: [{ text: prompt }] }],
    };

    if (options?.system_prompt) {
      body.systemInstruction = { parts: [{ text: options.system_prompt }] };
    }

    const generationConfig: GeminiGenerateRequest["generationConfig"] = {};
    if (options?.temperature !== undefined) {
      generationConfig.temperature = options.temperature;
    }
    if (options?.max_tokens !== undefined) {
      generationConfig.maxOutputTokens = options.max_tokens;
    }
    if (Object.keys(generationConfig).length > 0) {
      body.generationConfig = generationConfig;
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    // Geminiは認証をURLパラメータで渡す
    const keyParam = auth?.api_key ? `?key=${auth.api_key}` : "";
    const url = `${endpoint}/models/${model_name}:generateContent${keyParam}`;

    const signal = createAbortSignal(timeout_ms);

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal,
      });
    } catch (error: unknown) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(
          `Gemini request timed out after ${timeout_ms}ms`
        );
      }
      throw new Error(
        `Gemini network error: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      if (response.status === 401 || response.status === 403) {
        throw new Error(
          `Gemini authentication error (${response.status}): ${errorBody || response.statusText}. Please verify your API key configuration.`
        );
      }
      throw new Error(
        `Gemini API error (${response.status}): ${errorBody || response.statusText}`
      );
    }

    const data = (await response.json()) as GeminiGenerateResponse;

    const promptTokens = data.usageMetadata?.promptTokenCount;
    const completionTokens = data.usageMetadata?.candidatesTokenCount;
    const totalTokens = data.usageMetadata?.totalTokenCount;

    return {
      text: data.candidates?.[0]?.content?.parts?.[0]?.text ?? "",
      model_id: model_name,
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

      // Geminiはモデル情報取得エンドポイントで到達性確認
      const keyParam = entry.auth?.api_key ? `?key=${entry.auth.api_key}` : "";
      const url = `${entry.endpoint}/models/${entry.model_name}${keyParam}`;

      const response = await fetch(url, {
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
