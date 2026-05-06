/**
 * OpenAIAdapterのユニットテスト
 * fetch をモックしてレスポンス正規化・エラーハンドリングを検証
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { OpenAIAdapter } from "@/providers/openai.js";
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

describe("OpenAIAdapter", () => {
  let adapter: OpenAIAdapter;

  beforeEach(() => {
    adapter = new OpenAIAdapter();
  });

  afterEach(() => {
    restoreFetch();
  });

  test("providerプロパティが'openai'", () => {
    expect(adapter.provider).toBe("openai");
  });

  describe("generate", () => {
    const baseRequest: GenerateRequest = {
      prompt: "Hello, world!",
      model_name: "gpt-4o",
      endpoint: "https://api.openai.com/v1",
      auth: { api_key: "sk-test-key-123" },
      timeout_ms: 30000,
    };

    test("正常レスポンスをUnifiedResponseに正規化", async () => {
      mockFetch(async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "Hi there!" } }],
            model: "gpt-4o",
            usage: {
              prompt_tokens: 10,
              completion_tokens: 5,
              total_tokens: 15,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

      const result = await adapter.generate(baseRequest);

      expect(result.text).toBe("Hi there!");
      expect(result.model_id).toBe("gpt-4o");
      expect(result.provider).toBe("openai");
      expect(result.usage.prompt_tokens).toBe(10);
      expect(result.usage.completion_tokens).toBe(5);
      expect(result.usage.total_tokens).toBe(15);
    });

    test("usage情報が欠落している場合はundefined", async () => {
      mockFetch(async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "Response" } }],
            model: "gpt-4o",
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

    test("system_prompt指定時にsystemメッセージを先頭に追加", async () => {
      let capturedBody: string | undefined;

      mockFetch(async (_url, init) => {
        capturedBody = init?.body as string;
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "OK" } }],
            model: "gpt-4o",
            usage: { prompt_tokens: 15, completion_tokens: 2, total_tokens: 17 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      });

      await adapter.generate({
        ...baseRequest,
        options: { system_prompt: "You are a helpful assistant." },
      });

      const parsed = JSON.parse(capturedBody!);
      expect(parsed.messages).toHaveLength(2);
      expect(parsed.messages[0]).toEqual({
        role: "system",
        content: "You are a helpful assistant.",
      });
      expect(parsed.messages[1]).toEqual({
        role: "user",
        content: "Hello, world!",
      });
    });

    test("temperature/max_tokensをリクエストボディに直接設定", async () => {
      let capturedBody: string | undefined;

      mockFetch(async (_url, init) => {
        capturedBody = init?.body as string;
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "OK" } }],
            model: "gpt-4o",
            usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      });

      await adapter.generate({
        ...baseRequest,
        options: { temperature: 0.7, max_tokens: 100 },
      });

      const parsed = JSON.parse(capturedBody!);
      expect(parsed.temperature).toBe(0.7);
      expect(parsed.max_tokens).toBe(100);
    });

    test("stream: falseがリクエストボディに含まれる", async () => {
      let capturedBody: string | undefined;

      mockFetch(async (_url, init) => {
        capturedBody = init?.body as string;
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "OK" } }],
            model: "gpt-4o",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      });

      await adapter.generate(baseRequest);

      const parsed = JSON.parse(capturedBody!);
      expect(parsed.stream).toBe(false);
    });

    test("正しいエンドポイントURLにPOST", async () => {
      let capturedUrl: string | undefined;
      let capturedMethod: string | undefined;

      mockFetch(async (url, init) => {
        capturedUrl = url as string;
        capturedMethod = init?.method;
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "OK" } }],
            model: "gpt-4o",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      });

      await adapter.generate(baseRequest);

      expect(capturedUrl).toBe("https://api.openai.com/v1/chat/completions");
      expect(capturedMethod).toBe("POST");
    });

    test("Authorization Bearerヘッダーが設定される", async () => {
      let capturedHeaders: HeadersInit | undefined;

      mockFetch(async (_url, init) => {
        capturedHeaders = init?.headers;
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "OK" } }],
            model: "gpt-4o",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      });

      await adapter.generate(baseRequest);

      const headers = capturedHeaders as Record<string, string>;
      expect(headers["Authorization"]).toBe("Bearer sk-test-key-123");
      expect(headers["Content-Type"]).toBe("application/json");
    });

    test("auth未指定時はAuthorizationヘッダーなし", async () => {
      let capturedHeaders: HeadersInit | undefined;

      mockFetch(async (_url, init) => {
        capturedHeaders = init?.headers;
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "OK" } }],
            model: "gpt-4o",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      });

      await adapter.generate({
        ...baseRequest,
        auth: undefined,
      });

      const headers = capturedHeaders as Record<string, string>;
      expect(headers["Authorization"]).toBeUndefined();
      expect(headers["Content-Type"]).toBe("application/json");
    });

    test("401認証エラーで認証ヒント付きエラーthrow", async () => {
      mockFetch(async () =>
        new Response("Unauthorized", { status: 401, statusText: "Unauthorized" })
      );

      await expect(adapter.generate(baseRequest)).rejects.toThrow(
        "OpenAI authentication error (401)"
      );
    });

    test("403認証エラーで認証ヒント付きエラーthrow", async () => {
      mockFetch(async () =>
        new Response("Forbidden", { status: 403, statusText: "Forbidden" })
      );

      await expect(adapter.generate(baseRequest)).rejects.toThrow(
        "OpenAI authentication error (403)"
      );
    });

    test("非200ステータスでエラーthrow", async () => {
      mockFetch(async () =>
        new Response("model not found", { status: 404, statusText: "Not Found" })
      );

      await expect(adapter.generate(baseRequest)).rejects.toThrow(
        "OpenAI API error (404)"
      );
    });

    test("500エラーでエラーthrow", async () => {
      mockFetch(async () =>
        new Response("internal server error", { status: 500, statusText: "Internal Server Error" })
      );

      await expect(adapter.generate(baseRequest)).rejects.toThrow(
        "OpenAI API error (500)"
      );
    });

    test("ネットワークエラーでエラーthrow", async () => {
      mockFetch(async () => {
        throw new Error("Connection refused");
      });

      await expect(adapter.generate(baseRequest)).rejects.toThrow(
        "OpenAI network error: Connection refused"
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
      ).rejects.toThrow("OpenAI request timed out after 100ms");
    });

    test("choicesが空の場合は空文字列を返却", async () => {
      mockFetch(async () =>
        new Response(
          JSON.stringify({
            choices: [],
            model: "gpt-4o",
            usage: { prompt_tokens: 5, completion_tokens: 0, total_tokens: 5 },
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
      id: "cloud-gpt4",
      provider: "openai",
      endpoint: "https://api.openai.com/v1",
      model_name: "gpt-4o",
      capabilities: ["code_generation", "reasoning"],
      priority: 5,
      auth: { api_key: "sk-test-key-123" },
      timeout_ms: 30000,
    };

    test("正常時はreachable: trueとlatency_msを返却", async () => {
      mockFetch(async () =>
        new Response(JSON.stringify({ data: [] }), { status: 200 })
      );

      const result = await adapter.healthCheck(baseEntry);

      expect(result.model_id).toBe("cloud-gpt4");
      expect(result.provider).toBe("openai");
      expect(result.reachable).toBe(true);
      expect(result.latency_ms).toBeGreaterThanOrEqual(0);
      expect(result.error).toBeUndefined();
    });

    test("非200ステータスでreachable: falseとerror返却", async () => {
      mockFetch(async () =>
        new Response("", { status: 401, statusText: "Unauthorized" })
      );

      const result = await adapter.healthCheck(baseEntry);

      expect(result.model_id).toBe("cloud-gpt4");
      expect(result.provider).toBe("openai");
      expect(result.reachable).toBe(false);
      expect(result.error).toContain("401");
      expect(result.latency_ms).toBeGreaterThanOrEqual(0);
    });

    test("ネットワークエラーでreachable: falseとerror返却", async () => {
      mockFetch(async () => {
        throw new Error("Connection refused");
      });

      const result = await adapter.healthCheck(baseEntry);

      expect(result.model_id).toBe("cloud-gpt4");
      expect(result.provider).toBe("openai");
      expect(result.reachable).toBe(false);
      expect(result.error).toBe("Connection refused");
      expect(result.latency_ms).toBeGreaterThanOrEqual(0);
    });

    test("/modelsエンドポイントにGETリクエスト", async () => {
      let capturedUrl: string | undefined;
      let capturedMethod: string | undefined;

      mockFetch(async (url, init) => {
        capturedUrl = url as string;
        capturedMethod = init?.method;
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      });

      await adapter.healthCheck(baseEntry);

      expect(capturedUrl).toBe("https://api.openai.com/v1/models");
      expect(capturedMethod).toBe("GET");
    });

    test("healthCheckでAuthorizationヘッダーが設定される", async () => {
      let capturedHeaders: HeadersInit | undefined;

      mockFetch(async (_url, init) => {
        capturedHeaders = init?.headers;
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      });

      await adapter.healthCheck(baseEntry);

      const headers = capturedHeaders as Record<string, string>;
      expect(headers["Authorization"]).toBe("Bearer sk-test-key-123");
    });

    test("auth未設定時はAuthorizationヘッダーなし", async () => {
      let capturedHeaders: HeadersInit | undefined;

      mockFetch(async (_url, init) => {
        capturedHeaders = init?.headers;
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      });

      const entryWithoutAuth = { ...baseEntry, auth: undefined };
      await adapter.healthCheck(entryWithoutAuth);

      const headers = capturedHeaders as Record<string, string>;
      expect(headers["Authorization"]).toBeUndefined();
    });

    test("timeout_ms未設定時はデフォルト5000msを使用", async () => {
      let signalUsed = false;

      mockFetch(async (_url, init) => {
        signalUsed = init?.signal !== undefined;
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      });

      const entryWithoutTimeout = { ...baseEntry };
      delete (entryWithoutTimeout as any).timeout_ms;

      await adapter.healthCheck(entryWithoutTimeout);

      expect(signalUsed).toBe(true);
    });
  });
});
