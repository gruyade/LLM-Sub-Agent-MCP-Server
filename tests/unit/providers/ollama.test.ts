/**
 * OllamaAdapterのユニットテスト
 * fetch をモックしてレスポンス正規化・エラーハンドリングを検証
 */
import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { OllamaAdapter } from "@/providers/ollama.js";
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

describe("OllamaAdapter", () => {
  let adapter: OllamaAdapter;

  beforeEach(() => {
    adapter = new OllamaAdapter();
  });

  afterEach(() => {
    restoreFetch();
  });

  test("providerプロパティが'ollama'", () => {
    expect(adapter.provider).toBe("ollama");
  });

  describe("generate", () => {
    const baseRequest: GenerateRequest = {
      prompt: "Hello, world!",
      model_name: "codellama:13b",
      endpoint: "http://localhost:11434",
      timeout_ms: 30000,
    };

    test("正常レスポンスをUnifiedResponseに正規化", async () => {
      mockFetch(async () =>
        new Response(
          JSON.stringify({
            message: { role: "assistant", content: "Hi there!" },
            model: "codellama:13b",
            eval_count: 10,
            prompt_eval_count: 5,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

      const result = await adapter.generate(baseRequest);

      expect(result.text).toBe("Hi there!");
      expect(result.model_id).toBe("codellama:13b");
      expect(result.provider).toBe("ollama");
      expect(result.usage.prompt_tokens).toBe(5);
      expect(result.usage.completion_tokens).toBe(10);
      expect(result.usage.total_tokens).toBe(15);
    });

    test("usage情報が欠落している場合はundefined", async () => {
      mockFetch(async () =>
        new Response(
          JSON.stringify({
            message: { role: "assistant", content: "Response" },
            model: "llama2",
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
            message: { role: "assistant", content: "OK" },
            model: "codellama:13b",
            eval_count: 5,
            prompt_eval_count: 10,
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

    test("temperature/max_tokensをoptions.temperature/num_predictに変換", async () => {
      let capturedBody: string | undefined;

      mockFetch(async (_url, init) => {
        capturedBody = init?.body as string;
        return new Response(
          JSON.stringify({
            message: { role: "assistant", content: "OK" },
            model: "codellama:13b",
            eval_count: 5,
            prompt_eval_count: 3,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      });

      await adapter.generate({
        ...baseRequest,
        options: { temperature: 0.7, max_tokens: 100 },
      });

      const parsed = JSON.parse(capturedBody!);
      expect(parsed.options.temperature).toBe(0.7);
      expect(parsed.options.num_predict).toBe(100);
    });

    test("stream: falseがリクエストボディに含まれる", async () => {
      let capturedBody: string | undefined;

      mockFetch(async (_url, init) => {
        capturedBody = init?.body as string;
        return new Response(
          JSON.stringify({
            message: { role: "assistant", content: "OK" },
            model: "codellama:13b",
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
            message: { role: "assistant", content: "OK" },
            model: "codellama:13b",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      });

      await adapter.generate(baseRequest);

      expect(capturedUrl).toBe("http://localhost:11434/api/chat");
      expect(capturedMethod).toBe("POST");
    });

    test("非200ステータスでエラーthrow", async () => {
      mockFetch(async () =>
        new Response("model not found", { status: 404, statusText: "Not Found" })
      );

      await expect(adapter.generate(baseRequest)).rejects.toThrow(
        "Ollama API error (404)"
      );
    });

    test("500エラーでエラーthrow", async () => {
      mockFetch(async () =>
        new Response("internal server error", { status: 500, statusText: "Internal Server Error" })
      );

      await expect(adapter.generate(baseRequest)).rejects.toThrow(
        "Ollama API error (500)"
      );
    });

    test("ネットワークエラーでエラーthrow", async () => {
      mockFetch(async () => {
        throw new Error("Connection refused");
      });

      await expect(adapter.generate(baseRequest)).rejects.toThrow(
        "Ollama network error: Connection refused"
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
      ).rejects.toThrow("Ollama request timed out after 100ms");
    });
  });

  describe("healthCheck", () => {
    const baseEntry: ModelEntry = {
      id: "local-codegen",
      provider: "ollama",
      endpoint: "http://localhost:11434",
      model_name: "codellama:13b",
      capabilities: ["code_generation"],
      priority: 10,
      timeout_ms: 30000,
    };

    test("正常時はreachable: trueとlatency_msを返却", async () => {
      mockFetch(async () =>
        new Response(JSON.stringify({ models: [] }), { status: 200 })
      );

      const result = await adapter.healthCheck(baseEntry);

      expect(result.model_id).toBe("local-codegen");
      expect(result.provider).toBe("ollama");
      expect(result.reachable).toBe(true);
      expect(result.latency_ms).toBeGreaterThanOrEqual(0);
      expect(result.error).toBeUndefined();
    });

    test("非200ステータスでreachable: falseとerror返却", async () => {
      mockFetch(async () =>
        new Response("", { status: 503, statusText: "Service Unavailable" })
      );

      const result = await adapter.healthCheck(baseEntry);

      expect(result.model_id).toBe("local-codegen");
      expect(result.provider).toBe("ollama");
      expect(result.reachable).toBe(false);
      expect(result.error).toContain("503");
      expect(result.latency_ms).toBeGreaterThanOrEqual(0);
    });

    test("ネットワークエラーでreachable: falseとerror返却", async () => {
      mockFetch(async () => {
        throw new Error("Connection refused");
      });

      const result = await adapter.healthCheck(baseEntry);

      expect(result.model_id).toBe("local-codegen");
      expect(result.provider).toBe("ollama");
      expect(result.reachable).toBe(false);
      expect(result.error).toBe("Connection refused");
      expect(result.latency_ms).toBeGreaterThanOrEqual(0);
    });

    test("/api/tagsエンドポイントにGETリクエスト", async () => {
      let capturedUrl: string | undefined;
      let capturedMethod: string | undefined;

      mockFetch(async (url, init) => {
        capturedUrl = url as string;
        capturedMethod = init?.method;
        return new Response(JSON.stringify({ models: [] }), { status: 200 });
      });

      await adapter.healthCheck(baseEntry);

      expect(capturedUrl).toBe("http://localhost:11434/api/tags");
      expect(capturedMethod).toBe("GET");
    });

    test("timeout_ms未設定時はデフォルト5000msを使用", async () => {
      let signalUsed = false;

      mockFetch(async (_url, init) => {
        signalUsed = init?.signal !== undefined;
        return new Response(JSON.stringify({ models: [] }), { status: 200 });
      });

      const entryWithoutTimeout = { ...baseEntry };
      delete (entryWithoutTimeout as any).timeout_ms;

      await adapter.healthCheck(entryWithoutTimeout);

      expect(signalUsed).toBe(true);
    });
  });
});
