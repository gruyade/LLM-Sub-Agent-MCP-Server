/**
 * AnthropicAdapterのユニットテスト
 * fetch をモックしてレスポンス正規化・エラーハンドリングを検証
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { AnthropicAdapter } from "@/providers/anthropic.js";
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

describe("AnthropicAdapter", () => {
  let adapter: AnthropicAdapter;

  beforeEach(() => {
    adapter = new AnthropicAdapter();
  });

  afterEach(() => {
    restoreFetch();
  });

  test("providerプロパティが'anthropic'", () => {
    expect(adapter.provider).toBe("anthropic");
  });

  describe("generate", () => {
    const baseRequest: GenerateRequest = {
      prompt: "Hello, world!",
      model_name: "claude-sonnet-4-20250514",
      endpoint: "https://api.anthropic.com",
      auth: { api_key: "sk-ant-test-key-123" },
      timeout_ms: 30000,
    };

    test("正常レスポンスをUnifiedResponseに正規化", async () => {
      mockFetch(async () =>
        new Response(
          JSON.stringify({
            content: [{ type: "text", text: "Hi there!" }],
            model: "claude-sonnet-4-20250514",
            usage: {
              input_tokens: 10,
              output_tokens: 5,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

      const result = await adapter.generate(baseRequest);

      expect(result.text).toBe("Hi there!");
      expect(result.model_id).toBe("claude-sonnet-4-20250514");
      expect(result.provider).toBe("anthropic");
      expect(result.usage.prompt_tokens).toBe(10);
      expect(result.usage.completion_tokens).toBe(5);
      expect(result.usage.total_tokens).toBe(15);
    });

    test("usage情報が欠落している場合はundefined", async () => {
      mockFetch(async () =>
        new Response(
          JSON.stringify({
            content: [{ type: "text", text: "Response" }],
            model: "claude-sonnet-4-20250514",
            usage: {},
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

    test("system_prompt指定時にトップレベルsystemフィールドに設定", async () => {
      let capturedBody: string | undefined;

      mockFetch(async (_url, init) => {
        capturedBody = init?.body as string;
        return new Response(
          JSON.stringify({
            content: [{ type: "text", text: "OK" }],
            model: "claude-sonnet-4-20250514",
            usage: { input_tokens: 15, output_tokens: 2 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      });

      await adapter.generate({
        ...baseRequest,
        options: { system_prompt: "You are a helpful assistant." },
      });

      const parsed = JSON.parse(capturedBody!);
      expect(parsed.system).toBe("You are a helpful assistant.");
      // messagesにはsystemロールが含まれない
      expect(parsed.messages).toHaveLength(1);
      expect(parsed.messages[0]).toEqual({
        role: "user",
        content: "Hello, world!",
      });
    });

    test("system_prompt未指定時はsystemフィールドなし", async () => {
      let capturedBody: string | undefined;

      mockFetch(async (_url, init) => {
        capturedBody = init?.body as string;
        return new Response(
          JSON.stringify({
            content: [{ type: "text", text: "OK" }],
            model: "claude-sonnet-4-20250514",
            usage: { input_tokens: 5, output_tokens: 2 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      });

      await adapter.generate(baseRequest);

      const parsed = JSON.parse(capturedBody!);
      expect(parsed.system).toBeUndefined();
    });

    test("temperature指定時にリクエストボディに設定", async () => {
      let capturedBody: string | undefined;

      mockFetch(async (_url, init) => {
        capturedBody = init?.body as string;
        return new Response(
          JSON.stringify({
            content: [{ type: "text", text: "OK" }],
            model: "claude-sonnet-4-20250514",
            usage: { input_tokens: 5, output_tokens: 2 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      });

      await adapter.generate({
        ...baseRequest,
        options: { temperature: 0.7 },
      });

      const parsed = JSON.parse(capturedBody!);
      expect(parsed.temperature).toBe(0.7);
    });

    test("max_tokens指定時にリクエストボディに設定", async () => {
      let capturedBody: string | undefined;

      mockFetch(async (_url, init) => {
        capturedBody = init?.body as string;
        return new Response(
          JSON.stringify({
            content: [{ type: "text", text: "OK" }],
            model: "claude-sonnet-4-20250514",
            usage: { input_tokens: 5, output_tokens: 2 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      });

      await adapter.generate({
        ...baseRequest,
        options: { max_tokens: 100 },
      });

      const parsed = JSON.parse(capturedBody!);
      expect(parsed.max_tokens).toBe(100);
    });

    test("max_tokens未指定時はデフォルト4096", async () => {
      let capturedBody: string | undefined;

      mockFetch(async (_url, init) => {
        capturedBody = init?.body as string;
        return new Response(
          JSON.stringify({
            content: [{ type: "text", text: "OK" }],
            model: "claude-sonnet-4-20250514",
            usage: { input_tokens: 5, output_tokens: 2 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      });

      await adapter.generate(baseRequest);

      const parsed = JSON.parse(capturedBody!);
      expect(parsed.max_tokens).toBe(4096);
    });

    test("正しいエンドポイントURLにPOST", async () => {
      let capturedUrl: string | undefined;
      let capturedMethod: string | undefined;

      mockFetch(async (url, init) => {
        capturedUrl = url as string;
        capturedMethod = init?.method;
        return new Response(
          JSON.stringify({
            content: [{ type: "text", text: "OK" }],
            model: "claude-sonnet-4-20250514",
            usage: { input_tokens: 5, output_tokens: 2 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      });

      await adapter.generate(baseRequest);

      expect(capturedUrl).toBe("https://api.anthropic.com/v1/messages");
      expect(capturedMethod).toBe("POST");
    });

    test("x-api-keyヘッダーとanthropic-versionが設定される", async () => {
      let capturedHeaders: HeadersInit | undefined;

      mockFetch(async (_url, init) => {
        capturedHeaders = init?.headers;
        return new Response(
          JSON.stringify({
            content: [{ type: "text", text: "OK" }],
            model: "claude-sonnet-4-20250514",
            usage: { input_tokens: 5, output_tokens: 2 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      });

      await adapter.generate(baseRequest);

      const headers = capturedHeaders as Record<string, string>;
      expect(headers["x-api-key"]).toBe("sk-ant-test-key-123");
      expect(headers["Content-Type"]).toBe("application/json");
      expect(headers["anthropic-version"]).toBe("2023-06-01");
    });

    test("auth未指定時はx-api-keyヘッダーなし", async () => {
      let capturedHeaders: HeadersInit | undefined;

      mockFetch(async (_url, init) => {
        capturedHeaders = init?.headers;
        return new Response(
          JSON.stringify({
            content: [{ type: "text", text: "OK" }],
            model: "claude-sonnet-4-20250514",
            usage: { input_tokens: 5, output_tokens: 2 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      });

      await adapter.generate({
        ...baseRequest,
        auth: undefined,
      });

      const headers = capturedHeaders as Record<string, string>;
      expect(headers["x-api-key"]).toBeUndefined();
      expect(headers["Content-Type"]).toBe("application/json");
      expect(headers["anthropic-version"]).toBe("2023-06-01");
    });

    test("401認証エラーで認証ヒント付きエラーthrow", async () => {
      mockFetch(async () =>
        new Response("Unauthorized", { status: 401, statusText: "Unauthorized" })
      );

      await expect(adapter.generate(baseRequest)).rejects.toThrow(
        "Anthropic authentication error (401)"
      );
    });

    test("403認証エラーで認証ヒント付きエラーthrow", async () => {
      mockFetch(async () =>
        new Response("Forbidden", { status: 403, statusText: "Forbidden" })
      );

      await expect(adapter.generate(baseRequest)).rejects.toThrow(
        "Anthropic authentication error (403)"
      );
    });

    test("非200ステータスでエラーthrow", async () => {
      mockFetch(async () =>
        new Response("model not found", { status: 404, statusText: "Not Found" })
      );

      await expect(adapter.generate(baseRequest)).rejects.toThrow(
        "Anthropic API error (404)"
      );
    });

    test("500エラーでエラーthrow", async () => {
      mockFetch(async () =>
        new Response("internal server error", { status: 500, statusText: "Internal Server Error" })
      );

      await expect(adapter.generate(baseRequest)).rejects.toThrow(
        "Anthropic API error (500)"
      );
    });

    test("ネットワークエラーでエラーthrow", async () => {
      mockFetch(async () => {
        throw new Error("Connection refused");
      });

      await expect(adapter.generate(baseRequest)).rejects.toThrow(
        "Anthropic network error: Connection refused"
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
      ).rejects.toThrow("Anthropic request timed out after 100ms");
    });

    test("contentが空の場合は空文字列を返却", async () => {
      mockFetch(async () =>
        new Response(
          JSON.stringify({
            content: [],
            model: "claude-sonnet-4-20250514",
            usage: { input_tokens: 5, output_tokens: 0 },
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
      id: "cloud-claude",
      provider: "anthropic",
      endpoint: "https://api.anthropic.com",
      model_name: "claude-sonnet-4-20250514",
      capabilities: ["reasoning", "summarization"],
      priority: 8,
      auth: { api_key: "sk-ant-test-key-123" },
      timeout_ms: 30000,
    };

    test("正常時はreachable: trueとlatency_msを返却", async () => {
      mockFetch(async () =>
        new Response(
          JSON.stringify({
            content: [{ type: "text", text: "h" }],
            model: "claude-sonnet-4-20250514",
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
          { status: 200 }
        )
      );

      const result = await adapter.healthCheck(baseEntry);

      expect(result.model_id).toBe("cloud-claude");
      expect(result.provider).toBe("anthropic");
      expect(result.reachable).toBe(true);
      expect(result.latency_ms).toBeGreaterThanOrEqual(0);
      expect(result.error).toBeUndefined();
    });

    test("非200ステータスでreachable: falseとerror返却", async () => {
      mockFetch(async () =>
        new Response("", { status: 401, statusText: "Unauthorized" })
      );

      const result = await adapter.healthCheck(baseEntry);

      expect(result.model_id).toBe("cloud-claude");
      expect(result.provider).toBe("anthropic");
      expect(result.reachable).toBe(false);
      expect(result.error).toContain("401");
      expect(result.latency_ms).toBeGreaterThanOrEqual(0);
    });

    test("ネットワークエラーでreachable: falseとerror返却", async () => {
      mockFetch(async () => {
        throw new Error("Connection refused");
      });

      const result = await adapter.healthCheck(baseEntry);

      expect(result.model_id).toBe("cloud-claude");
      expect(result.provider).toBe("anthropic");
      expect(result.reachable).toBe(false);
      expect(result.error).toBe("Connection refused");
      expect(result.latency_ms).toBeGreaterThanOrEqual(0);
    });

    test("/v1/messagesエンドポイントにPOSTリクエスト", async () => {
      let capturedUrl: string | undefined;
      let capturedMethod: string | undefined;

      mockFetch(async (url, init) => {
        capturedUrl = url as string;
        capturedMethod = init?.method;
        return new Response(
          JSON.stringify({
            content: [{ type: "text", text: "h" }],
            model: "claude-sonnet-4-20250514",
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
          { status: 200 }
        );
      });

      await adapter.healthCheck(baseEntry);

      expect(capturedUrl).toBe("https://api.anthropic.com/v1/messages");
      expect(capturedMethod).toBe("POST");
    });

    test("healthCheckでx-api-keyヘッダーが設定される", async () => {
      let capturedHeaders: HeadersInit | undefined;

      mockFetch(async (_url, init) => {
        capturedHeaders = init?.headers;
        return new Response(
          JSON.stringify({
            content: [{ type: "text", text: "h" }],
            model: "claude-sonnet-4-20250514",
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
          { status: 200 }
        );
      });

      await adapter.healthCheck(baseEntry);

      const headers = capturedHeaders as Record<string, string>;
      expect(headers["x-api-key"]).toBe("sk-ant-test-key-123");
      expect(headers["anthropic-version"]).toBe("2023-06-01");
    });

    test("auth未設定時はx-api-keyヘッダーなし", async () => {
      let capturedHeaders: HeadersInit | undefined;

      mockFetch(async (_url, init) => {
        capturedHeaders = init?.headers;
        return new Response(
          JSON.stringify({
            content: [{ type: "text", text: "h" }],
            model: "claude-sonnet-4-20250514",
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
          { status: 200 }
        );
      });

      const entryWithoutAuth = { ...baseEntry, auth: undefined };
      await adapter.healthCheck(entryWithoutAuth);

      const headers = capturedHeaders as Record<string, string>;
      expect(headers["x-api-key"]).toBeUndefined();
    });

    test("healthCheckリクエストボディにmax_tokens: 1が設定される", async () => {
      let capturedBody: string | undefined;

      mockFetch(async (_url, init) => {
        capturedBody = init?.body as string;
        return new Response(
          JSON.stringify({
            content: [{ type: "text", text: "h" }],
            model: "claude-sonnet-4-20250514",
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
          { status: 200 }
        );
      });

      await adapter.healthCheck(baseEntry);

      const parsed = JSON.parse(capturedBody!);
      expect(parsed.max_tokens).toBe(1);
      expect(parsed.model).toBe("claude-sonnet-4-20250514");
      expect(parsed.messages).toHaveLength(1);
    });

    test("timeout_ms未設定時はデフォルト5000msを使用", async () => {
      let signalUsed = false;

      mockFetch(async (_url, init) => {
        signalUsed = init?.signal !== undefined;
        return new Response(
          JSON.stringify({
            content: [{ type: "text", text: "h" }],
            model: "claude-sonnet-4-20250514",
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
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
