/**
 * GeminiAdapterのユニットテスト
 * fetch をモックしてレスポンス正規化・エラーハンドリングを検証
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GeminiAdapter } from "@/providers/gemini.js";
import type { GenerateRequest } from "@/providers/base.js";
import type { ModelEntry } from "@/config/types.js";

// グローバルfetchのモック管理
const originalFetch = globalThis.fetch;

function mockFetch(impl: (url: string | URL | Request, init?: RequestInit) => Promise<Response>) {
  globalThis.fetch = impl as typeof globalThis.fetch;
}

function restoreFetch() {
  globalThis.fetch = originalFetch;
}

describe("GeminiAdapter", () => {
  let adapter: GeminiAdapter;

  beforeEach(() => {
    adapter = new GeminiAdapter();
  });

  afterEach(() => {
    restoreFetch();
  });

  test("providerプロパティが'gemini'", () => {
    expect(adapter.provider).toBe("gemini");
  });

  describe("generate", () => {
    const baseRequest: GenerateRequest = {
      prompt: "Hello, world!",
      model_name: "gemini-2.5-flash",
      endpoint: "https://generativelanguage.googleapis.com/v1beta",
      auth: { api_key: "test-google-api-key" },
      timeout_ms: 30000,
    };

    test("正常レスポンスをUnifiedResponseに正規化", async () => {
      mockFetch(async () =>
        new Response(
          JSON.stringify({
            candidates: [{
              content: {
                parts: [{ text: "Hi there!" }],
              },
            }],
            usageMetadata: {
              promptTokenCount: 10,
              candidatesTokenCount: 5,
              totalTokenCount: 15,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

      const result = await adapter.generate(baseRequest);

      expect(result.text).toBe("Hi there!");
      expect(result.model_id).toBe("gemini-2.5-flash");
      expect(result.provider).toBe("gemini");
      expect(result.usage.prompt_tokens).toBe(10);
      expect(result.usage.completion_tokens).toBe(5);
      expect(result.usage.total_tokens).toBe(15);
    });

    test("usageMetadata欠落時はundefined", async () => {
      mockFetch(async () =>
        new Response(
          JSON.stringify({
            candidates: [{
              content: {
                parts: [{ text: "Response" }],
              },
            }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

      const result = await adapter.generate(baseRequest);

      expect(result.text).toBe("Response");
      expect(result.usage.prompt_tokens).toBeUndefined();
      expect(result.usage.completion_tokens).toBeUndefined();
      expect(result.usage.total_tokens).toBeUndefined();
    });

    test("system_prompt指定時にsystemInstructionフィールドに設定", async () => {
      let capturedBody: string | undefined;

      mockFetch(async (_url, init) => {
        capturedBody = init?.body as string;
        return new Response(
          JSON.stringify({
            candidates: [{
              content: { parts: [{ text: "OK" }] },
            }],
            usageMetadata: { promptTokenCount: 15, candidatesTokenCount: 2, totalTokenCount: 17 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      });

      await adapter.generate({
        ...baseRequest,
        options: { system_prompt: "You are a helpful assistant." },
      });

      const parsed = JSON.parse(capturedBody!);
      expect(parsed.systemInstruction).toEqual({
        parts: [{ text: "You are a helpful assistant." }],
      });
      expect(parsed.contents).toEqual([{ parts: [{ text: "Hello, world!" }] }]);
    });

    test("system_prompt未指定時はsystemInstructionフィールドなし", async () => {
      let capturedBody: string | undefined;

      mockFetch(async (_url, init) => {
        capturedBody = init?.body as string;
        return new Response(
          JSON.stringify({
            candidates: [{
              content: { parts: [{ text: "OK" }] },
            }],
            usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2, totalTokenCount: 7 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      });

      await adapter.generate(baseRequest);

      const parsed = JSON.parse(capturedBody!);
      expect(parsed.systemInstruction).toBeUndefined();
    });

    test("temperature指定時にgenerationConfigに設定", async () => {
      let capturedBody: string | undefined;

      mockFetch(async (_url, init) => {
        capturedBody = init?.body as string;
        return new Response(
          JSON.stringify({
            candidates: [{
              content: { parts: [{ text: "OK" }] },
            }],
            usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2, totalTokenCount: 7 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      });

      await adapter.generate({
        ...baseRequest,
        options: { temperature: 0.7 },
      });

      const parsed = JSON.parse(capturedBody!);
      expect(parsed.generationConfig.temperature).toBe(0.7);
    });

    test("max_tokens指定時にgenerationConfig.maxOutputTokensに設定", async () => {
      let capturedBody: string | undefined;

      mockFetch(async (_url, init) => {
        capturedBody = init?.body as string;
        return new Response(
          JSON.stringify({
            candidates: [{
              content: { parts: [{ text: "OK" }] },
            }],
            usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2, totalTokenCount: 7 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      });

      await adapter.generate({
        ...baseRequest,
        options: { max_tokens: 100 },
      });

      const parsed = JSON.parse(capturedBody!);
      expect(parsed.generationConfig.maxOutputTokens).toBe(100);
    });

    test("options未指定時はgenerationConfigなし", async () => {
      let capturedBody: string | undefined;

      mockFetch(async (_url, init) => {
        capturedBody = init?.body as string;
        return new Response(
          JSON.stringify({
            candidates: [{
              content: { parts: [{ text: "OK" }] },
            }],
            usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2, totalTokenCount: 7 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      });

      await adapter.generate(baseRequest);

      const parsed = JSON.parse(capturedBody!);
      expect(parsed.generationConfig).toBeUndefined();
    });

    test("正しいエンドポイントURLにPOST（keyパラメータ付き）", async () => {
      let capturedUrl: string | undefined;
      let capturedMethod: string | undefined;

      mockFetch(async (url, init) => {
        capturedUrl = url as string;
        capturedMethod = init?.method;
        return new Response(
          JSON.stringify({
            candidates: [{
              content: { parts: [{ text: "OK" }] },
            }],
            usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2, totalTokenCount: 7 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      });

      await adapter.generate(baseRequest);

      expect(capturedUrl).toBe(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=test-google-api-key"
      );
      expect(capturedMethod).toBe("POST");
    });

    test("Content-Typeヘッダーが設定される（認証ヘッダーなし）", async () => {
      let capturedHeaders: HeadersInit | undefined;

      mockFetch(async (_url, init) => {
        capturedHeaders = init?.headers;
        return new Response(
          JSON.stringify({
            candidates: [{
              content: { parts: [{ text: "OK" }] },
            }],
            usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2, totalTokenCount: 7 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      });

      await adapter.generate(baseRequest);

      const headers = capturedHeaders as Record<string, string>;
      expect(headers["Content-Type"]).toBe("application/json");
      // Geminiは認証ヘッダーを使わない（URLパラメータ）
      expect(headers["Authorization"]).toBeUndefined();
      expect(headers["x-api-key"]).toBeUndefined();
    });

    test("auth未指定時はkeyパラメータなしのURL", async () => {
      let capturedUrl: string | undefined;

      mockFetch(async (url) => {
        capturedUrl = url as string;
        return new Response(
          JSON.stringify({
            candidates: [{
              content: { parts: [{ text: "OK" }] },
            }],
            usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2, totalTokenCount: 7 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      });

      await adapter.generate({
        ...baseRequest,
        auth: undefined,
      });

      expect(capturedUrl).toBe(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"
      );
    });

    test("401認証エラーで認証ヒント付きエラーthrow", async () => {
      mockFetch(async () =>
        new Response("Unauthorized", { status: 401, statusText: "Unauthorized" })
      );

      await expect(adapter.generate(baseRequest)).rejects.toThrow(
        "Gemini authentication error (401)"
      );
    });

    test("403認証エラーで認証ヒント付きエラーthrow", async () => {
      mockFetch(async () =>
        new Response("Forbidden", { status: 403, statusText: "Forbidden" })
      );

      await expect(adapter.generate(baseRequest)).rejects.toThrow(
        "Gemini authentication error (403)"
      );
    });

    test("非200ステータスでエラーthrow", async () => {
      mockFetch(async () =>
        new Response("model not found", { status: 404, statusText: "Not Found" })
      );

      await expect(adapter.generate(baseRequest)).rejects.toThrow(
        "Gemini API error (404)"
      );
    });

    test("500エラーでエラーthrow", async () => {
      mockFetch(async () =>
        new Response("internal server error", { status: 500, statusText: "Internal Server Error" })
      );

      await expect(adapter.generate(baseRequest)).rejects.toThrow(
        "Gemini API error (500)"
      );
    });

    test("ネットワークエラーでエラーthrow", async () => {
      mockFetch(async () => {
        throw new Error("Connection refused");
      });

      await expect(adapter.generate(baseRequest)).rejects.toThrow(
        "Gemini network error: Connection refused"
      );
    });

    test("タイムアウトでエラーthrow", async () => {
      mockFetch(async () => {
        const error = new Error("The operation was aborted");
        error.name = "AbortError";
        throw error;
      });

      await expect(
        adapter.generate({ ...baseRequest, timeout_ms: 100 })
      ).rejects.toThrow("Gemini request timed out after 100ms");
    });

    test("candidatesが空の場合は空文字列を返却", async () => {
      mockFetch(async () =>
        new Response(
          JSON.stringify({
            candidates: [],
            usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 0, totalTokenCount: 5 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

      const result = await adapter.generate(baseRequest);

      expect(result.text).toBe("");
    });

    test("candidates未定義の場合は空文字列を返却", async () => {
      mockFetch(async () =>
        new Response(
          JSON.stringify({
            usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 0, totalTokenCount: 5 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

      const result = await adapter.generate(baseRequest);

      expect(result.text).toBe("");
    });
  });

  describe("healthCheck", () => {
    const baseEntry: ModelEntry = {
      id: "cloud-gemini",
      provider: "gemini",
      endpoint: "https://generativelanguage.googleapis.com/v1beta",
      model_name: "gemini-2.5-flash",
      capabilities: ["summarization", "translation", "chat"],
      priority: 6,
      auth: { api_key: "test-google-api-key" },
      timeout_ms: 30000,
    };

    test("正常時はreachable: trueとlatency_msを返却", async () => {
      mockFetch(async () =>
        new Response(
          JSON.stringify({
            name: "models/gemini-2.5-flash",
            displayName: "Gemini 2.5 Flash",
          }),
          { status: 200 }
        )
      );

      const result = await adapter.healthCheck(baseEntry);

      expect(result.model_id).toBe("cloud-gemini");
      expect(result.provider).toBe("gemini");
      expect(result.reachable).toBe(true);
      expect(result.latency_ms).toBeGreaterThanOrEqual(0);
      expect(result.error).toBeUndefined();
    });

    test("非200ステータスでreachable: falseとerror返却", async () => {
      mockFetch(async () =>
        new Response("", { status: 401, statusText: "Unauthorized" })
      );

      const result = await adapter.healthCheck(baseEntry);

      expect(result.model_id).toBe("cloud-gemini");
      expect(result.provider).toBe("gemini");
      expect(result.reachable).toBe(false);
      expect(result.error).toContain("401");
      expect(result.latency_ms).toBeGreaterThanOrEqual(0);
    });

    test("ネットワークエラーでreachable: falseとerror返却", async () => {
      mockFetch(async () => {
        throw new Error("Connection refused");
      });

      const result = await adapter.healthCheck(baseEntry);

      expect(result.model_id).toBe("cloud-gemini");
      expect(result.provider).toBe("gemini");
      expect(result.reachable).toBe(false);
      expect(result.error).toBe("Connection refused");
      expect(result.latency_ms).toBeGreaterThanOrEqual(0);
    });

    test("モデル情報エンドポイントにGETリクエスト（keyパラメータ付き）", async () => {
      let capturedUrl: string | undefined;
      let capturedMethod: string | undefined;

      mockFetch(async (url, init) => {
        capturedUrl = url as string;
        capturedMethod = init?.method;
        return new Response(
          JSON.stringify({ name: "models/gemini-2.5-flash" }),
          { status: 200 }
        );
      });

      await adapter.healthCheck(baseEntry);

      expect(capturedUrl).toBe(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash?key=test-google-api-key"
      );
      expect(capturedMethod).toBe("GET");
    });

    test("auth未設定時はkeyパラメータなしのURL", async () => {
      let capturedUrl: string | undefined;

      mockFetch(async (url) => {
        capturedUrl = url as string;
        return new Response(
          JSON.stringify({ name: "models/gemini-2.5-flash" }),
          { status: 200 }
        );
      });

      const entryWithoutAuth = { ...baseEntry, auth: undefined };
      await adapter.healthCheck(entryWithoutAuth);

      expect(capturedUrl).toBe(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash"
      );
    });

    test("timeout_ms未設定時はデフォルト5000msを使用", async () => {
      let signalUsed = false;

      mockFetch(async (_url, init) => {
        signalUsed = init?.signal !== undefined;
        return new Response(
          JSON.stringify({ name: "models/gemini-2.5-flash" }),
          { status: 200 }
        );
      });

      const entryWithoutTimeout = { ...baseEntry };
      delete (entryWithoutTimeout as any).timeout_ms;

      await adapter.healthCheck(entryWithoutTimeout);

      expect(signalUsed).toBe(true);
    });
  });
});
