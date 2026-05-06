/**
 * invoke_llm ツールハンドラのユニットテスト
 * Requirements: 4.1, 4.4, 5.1, 5.3
 */
import { describe, test, expect } from "bun:test";
import { handleInvokeLlm, invokeLlmSchema } from "@/tools/invoke-llm.js";
import { CapabilityRouter } from "@/router/capability-router.js";
import { ModelRegistry } from "@/registry/model-registry.js";
import type { ProviderAdapter, GenerateRequest } from "@/providers/base.js";
import type { ModelEntry } from "@/config/types.js";
import type { UnifiedResponse, HealthStatus } from "@/types/response.js";

/** テスト用モデルエントリ */
const testModels: ModelEntry[] = [
  {
    id: "test-ollama",
    provider: "ollama",
    endpoint: "http://localhost:11434",
    model_name: "llama3",
    capabilities: ["code_generation", "reasoning"],
    priority: 10,
    timeout_ms: 30000,
  },
  {
    id: "test-openai",
    provider: "openai",
    endpoint: "https://api.openai.com/v1",
    model_name: "gpt-4o",
    capabilities: ["reasoning", "summarization"],
    priority: 5,
    auth: { api_key: "sk-test-key" },
    timeout_ms: 30000,
  },
];

/** テスト用プロバイダ（成功） */
function createMockProvider(providerName: string): ProviderAdapter {
  return {
    provider: providerName,
    async generate(request: GenerateRequest): Promise<UnifiedResponse> {
      return {
        text: `Response to: ${request.prompt}`,
        model_id: request.model_name,
        provider: providerName,
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      };
    },
    async healthCheck(): Promise<HealthStatus> {
      return { model_id: "", provider: providerName, reachable: true };
    },
  };
}

/** テスト用プロバイダ（エラー） */
function createErrorProvider(providerName: string, errorMsg: string): ProviderAdapter {
  return {
    provider: providerName,
    async generate(): Promise<UnifiedResponse> {
      throw new Error(errorMsg);
    },
    async healthCheck(): Promise<HealthStatus> {
      return { model_id: "", provider: providerName, reachable: false };
    },
  };
}

/** テスト用プロバイダマップ生成 */
function createTestProviders(): Map<string, ProviderAdapter> {
  const map = new Map<string, ProviderAdapter>();
  map.set("ollama", createMockProvider("ollama"));
  map.set("openai", createMockProvider("openai"));
  return map;
}

function createRouter(): CapabilityRouter {
  const registry = new ModelRegistry(testModels);
  return new CapabilityRouter(registry);
}

describe("invokeLlmSchema", () => {
  test("promptは必須の文字列", () => {
    expect(invokeLlmSchema.prompt).toBeDefined();
  });

  test("capability, model_id, optionsはoptional", () => {
    expect(invokeLlmSchema.capability).toBeDefined();
    expect(invokeLlmSchema.model_id).toBeDefined();
    expect(invokeLlmSchema.options).toBeDefined();
  });
});

describe("handleInvokeLlm", () => {
  describe("正常系", () => {
    test("capability指定でルーティング → UnifiedResponse返却", async () => {
      const router = createRouter();
      const providers = createTestProviders();

      const result = await handleInvokeLlm(
        { prompt: "Hello", capability: "code_generation" },
        router,
        providers,
      );

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);
      const response = JSON.parse(result.content[0].text);
      expect(response.text).toContain("Hello");
      expect(response.provider).toBe("ollama");
      expect(response.usage).toBeDefined();
    });

    test("model_id指定で直接転送 → UnifiedResponse返却", async () => {
      const router = createRouter();
      const providers = createTestProviders();

      const result = await handleInvokeLlm(
        { prompt: "Test", model_id: "test-openai" },
        router,
        providers,
      );

      expect(result.isError).toBeUndefined();
      const response = JSON.parse(result.content[0].text);
      expect(response.provider).toBe("openai");
    });

    test("capability/model_id両方なし → デフォルトモデル（priority最高）選択", async () => {
      const router = createRouter();
      const providers = createTestProviders();

      const result = await handleInvokeLlm(
        { prompt: "Default" },
        router,
        providers,
      );

      expect(result.isError).toBeUndefined();
      const response = JSON.parse(result.content[0].text);
      // priority最高はtest-ollama (priority: 10)
      expect(response.provider).toBe("ollama");
    });

    test("options付きリクエストが正常に処理される", async () => {
      const router = createRouter();
      const providers = createTestProviders();

      const result = await handleInvokeLlm(
        {
          prompt: "With options",
          capability: "reasoning",
          options: { temperature: 0.7, max_tokens: 100, system_prompt: "Be helpful" },
        },
        router,
        providers,
      );

      expect(result.isError).toBeUndefined();
      const response = JSON.parse(result.content[0].text);
      expect(response.text).toContain("With options");
    });
  });

  describe("ルーティングエラー", () => {
    test("存在しないcapabilityでroutingエラー返却", async () => {
      const router = createRouter();
      const providers = createTestProviders();

      const result = await handleInvokeLlm(
        { prompt: "Test", capability: "nonexistent_capability" },
        router,
        providers,
      );

      expect(result.isError).toBe(true);
      const error = JSON.parse(result.content[0].text);
      expect(error.error).toBe(true);
      expect(error.error_type).toBe("routing");
      expect(error.message).toContain("nonexistent_capability");
    });

    test("存在しないmodel_idでroutingエラー返却", async () => {
      const router = createRouter();
      const providers = createTestProviders();

      const result = await handleInvokeLlm(
        { prompt: "Test", model_id: "nonexistent-model" },
        router,
        providers,
      );

      expect(result.isError).toBe(true);
      const error = JSON.parse(result.content[0].text);
      expect(error.error).toBe(true);
      expect(error.error_type).toBe("routing");
      expect(error.message).toContain("nonexistent-model");
    });
  });

  describe("プロバイダエラー", () => {
    test("プロバイダがマップに存在しない場合providerエラー返却", async () => {
      // anthropicプロバイダのモデルを追加するがマップには登録しない
      const models: ModelEntry[] = [
        {
          id: "test-anthropic",
          provider: "anthropic",
          endpoint: "https://api.anthropic.com",
          model_name: "claude-sonnet-4-20250514",
          capabilities: ["reasoning"],
          priority: 20,
          timeout_ms: 30000,
        },
      ];
      const registry = new ModelRegistry(models);
      const router = new CapabilityRouter(registry);
      const providers = new Map<string, ProviderAdapter>(); // 空マップ

      const result = await handleInvokeLlm(
        { prompt: "Test", model_id: "test-anthropic" },
        router,
        providers,
      );

      expect(result.isError).toBe(true);
      const error = JSON.parse(result.content[0].text);
      expect(error.error).toBe(true);
      expect(error.error_type).toBe("provider");
      expect(error.message).toContain("Unknown provider");
      expect(error.model_id).toBe("test-anthropic");
      expect(error.provider).toBe("anthropic");
    });

    test("プロバイダがエラーをthrowした場合providerエラー返却", async () => {
      const router = createRouter();
      const providers = new Map<string, ProviderAdapter>();
      providers.set("ollama", createErrorProvider("ollama", "Connection refused"));

      const result = await handleInvokeLlm(
        { prompt: "Test", model_id: "test-ollama" },
        router,
        providers,
      );

      expect(result.isError).toBe(true);
      const error = JSON.parse(result.content[0].text);
      expect(error.error).toBe(true);
      expect(error.error_type).toBe("provider");
      expect(error.message).toBe("Connection refused");
      expect(error.model_id).toBe("test-ollama");
      expect(error.provider).toBe("ollama");
    });

    test("タイムアウトエラーでtimeoutタイプ返却", async () => {
      const router = createRouter();
      const providers = new Map<string, ProviderAdapter>();
      providers.set("ollama", createErrorProvider("ollama", "Request timed out after 30000ms"));

      const result = await handleInvokeLlm(
        { prompt: "Test", model_id: "test-ollama" },
        router,
        providers,
      );

      expect(result.isError).toBe(true);
      const error = JSON.parse(result.content[0].text);
      expect(error.error).toBe(true);
      expect(error.error_type).toBe("timeout");
      expect(error.message).toContain("timed out");
    });
  });

  describe("レスポンスフォーマット", () => {
    test("成功時のレスポンスにisErrorが含まれない", async () => {
      const router = createRouter();
      const providers = createTestProviders();

      const result = await handleInvokeLlm(
        { prompt: "Test" },
        router,
        providers,
      );

      expect(result.isError).toBeUndefined();
      expect(result.content[0].type).toBe("text");
    });

    test("エラー時のレスポンスにisError: trueが含まれる", async () => {
      const router = createRouter();
      const providers = createTestProviders();

      const result = await handleInvokeLlm(
        { prompt: "Test", capability: "nonexistent" },
        router,
        providers,
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].type).toBe("text");
    });
  });
});
