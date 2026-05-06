/**
 * health_check ツールハンドラのユニットテスト
 * Requirements: 4.3
 */
import { describe, test, expect } from "bun:test";
import { handleHealthCheck } from "@/tools/health-check.js";
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
    capabilities: ["code_generation"],
    priority: 10,
    timeout_ms: 30000,
  },
  {
    id: "test-openai",
    provider: "openai",
    endpoint: "https://api.openai.com/v1",
    model_name: "gpt-4o",
    capabilities: ["reasoning"],
    priority: 5,
    auth: { api_key: "sk-test" },
    timeout_ms: 30000,
  },
  {
    id: "test-gemini",
    provider: "gemini",
    endpoint: "https://generativelanguage.googleapis.com/v1beta",
    model_name: "gemini-2.5-flash",
    capabilities: ["chat"],
    priority: 3,
    auth: { env_var: "GOOGLE_API_KEY" },
    timeout_ms: 30000,
  },
];

/** テスト用プロバイダ（正常） */
function createHealthyProvider(providerName: string, latency: number): ProviderAdapter {
  return {
    provider: providerName,
    async generate(_request: GenerateRequest): Promise<UnifiedResponse> {
      return { text: "", model_id: "", provider: providerName, usage: {} };
    },
    async healthCheck(entry: ModelEntry): Promise<HealthStatus> {
      return {
        model_id: entry.id,
        provider: providerName,
        reachable: true,
        latency_ms: latency,
      };
    },
  };
}

/** テスト用プロバイダ（healthCheckがthrow） */
function createUnhealthyProvider(providerName: string, errorMsg: string): ProviderAdapter {
  return {
    provider: providerName,
    async generate(_request: GenerateRequest): Promise<UnifiedResponse> {
      return { text: "", model_id: "", provider: providerName, usage: {} };
    },
    async healthCheck(): Promise<HealthStatus> {
      throw new Error(errorMsg);
    },
  };
}

describe("handleHealthCheck", () => {
  describe("正常系", () => {
    test("全モデルのヘルスチェック結果を返却", async () => {
      const registry = new ModelRegistry(testModels);
      const providers = new Map<string, ProviderAdapter>();
      providers.set("ollama", createHealthyProvider("ollama", 50));
      providers.set("openai", createHealthyProvider("openai", 120));
      providers.set("gemini", createHealthyProvider("gemini", 200));

      const result = await handleHealthCheck(registry, providers);

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe("text");

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.results).toHaveLength(3);
    });

    test("各結果にmodel_id, provider, reachable, latency_msが含まれる", async () => {
      const registry = new ModelRegistry([testModels[0]]);
      const providers = new Map<string, ProviderAdapter>();
      providers.set("ollama", createHealthyProvider("ollama", 42));

      const result = await handleHealthCheck(registry, providers);
      const parsed = JSON.parse(result.content[0].text);
      const status = parsed.results[0];

      expect(status.model_id).toBe("test-ollama");
      expect(status.provider).toBe("ollama");
      expect(status.reachable).toBe(true);
      expect(status.latency_ms).toBe(42);
      expect(status.error).toBeUndefined();
    });

    test("並列実行される（Promise.all）", async () => {
      const registry = new ModelRegistry(testModels);
      const providers = new Map<string, ProviderAdapter>();

      // 各プロバイダに遅延を入れて並列実行を確認
      const createDelayedProvider = (name: string, delayMs: number): ProviderAdapter => ({
        provider: name,
        async generate(_request: GenerateRequest): Promise<UnifiedResponse> {
          return { text: "", model_id: "", provider: name, usage: {} };
        },
        async healthCheck(entry: ModelEntry): Promise<HealthStatus> {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          return { model_id: entry.id, provider: name, reachable: true, latency_ms: delayMs };
        },
      });

      providers.set("ollama", createDelayedProvider("ollama", 50));
      providers.set("openai", createDelayedProvider("openai", 50));
      providers.set("gemini", createDelayedProvider("gemini", 50));

      const start = Date.now();
      await handleHealthCheck(registry, providers);
      const elapsed = Date.now() - start;

      // 並列実行なら合計150msではなく約50ms程度で完了
      expect(elapsed).toBeLessThan(120);
    });
  });

  describe("プロバイダ未登録", () => {
    test("プロバイダがマップに存在しない場合reachable: falseとerrorを返却", async () => {
      const registry = new ModelRegistry([testModels[0]]);
      const providers = new Map<string, ProviderAdapter>(); // 空マップ

      const result = await handleHealthCheck(registry, providers);
      const parsed = JSON.parse(result.content[0].text);
      const status = parsed.results[0];

      expect(status.model_id).toBe("test-ollama");
      expect(status.provider).toBe("ollama");
      expect(status.reachable).toBe(false);
      expect(status.error).toBe("Unknown provider: ollama");
    });

    test("一部のプロバイダのみ未登録の場合、該当モデルのみエラー", async () => {
      const registry = new ModelRegistry(testModels);
      const providers = new Map<string, ProviderAdapter>();
      providers.set("ollama", createHealthyProvider("ollama", 30));
      providers.set("openai", createHealthyProvider("openai", 100));
      // geminiは未登録

      const result = await handleHealthCheck(registry, providers);
      const parsed = JSON.parse(result.content[0].text);

      const ollamaStatus = parsed.results.find((r: HealthStatus) => r.model_id === "test-ollama");
      const openaiStatus = parsed.results.find((r: HealthStatus) => r.model_id === "test-openai");
      const geminiStatus = parsed.results.find((r: HealthStatus) => r.model_id === "test-gemini");

      expect(ollamaStatus.reachable).toBe(true);
      expect(openaiStatus.reachable).toBe(true);
      expect(geminiStatus.reachable).toBe(false);
      expect(geminiStatus.error).toBe("Unknown provider: gemini");
    });
  });

  describe("healthCheckエラー", () => {
    test("healthCheckがthrowした場合reachable: falseとerrorメッセージを返却", async () => {
      const registry = new ModelRegistry([testModels[0]]);
      const providers = new Map<string, ProviderAdapter>();
      providers.set("ollama", createUnhealthyProvider("ollama", "Connection refused"));

      const result = await handleHealthCheck(registry, providers);
      const parsed = JSON.parse(result.content[0].text);
      const status = parsed.results[0];

      expect(status.model_id).toBe("test-ollama");
      expect(status.provider).toBe("ollama");
      expect(status.reachable).toBe(false);
      expect(status.error).toBe("Connection refused");
    });

    test("非Errorオブジェクトがthrowされた場合も文字列化して返却", async () => {
      const registry = new ModelRegistry([testModels[0]]);
      const providers = new Map<string, ProviderAdapter>();
      providers.set("ollama", {
        provider: "ollama",
        async generate(_request: GenerateRequest): Promise<UnifiedResponse> {
          return { text: "", model_id: "", provider: "ollama", usage: {} };
        },
        async healthCheck(): Promise<HealthStatus> {
          throw "string error";
        },
      });

      const result = await handleHealthCheck(registry, providers);
      const parsed = JSON.parse(result.content[0].text);
      const status = parsed.results[0];

      expect(status.reachable).toBe(false);
      expect(status.error).toBe("string error");
    });

    test("一部モデルがエラーでも他のモデルは正常に返却", async () => {
      const registry = new ModelRegistry(testModels);
      const providers = new Map<string, ProviderAdapter>();
      providers.set("ollama", createUnhealthyProvider("ollama", "timeout"));
      providers.set("openai", createHealthyProvider("openai", 80));
      providers.set("gemini", createHealthyProvider("gemini", 150));

      const result = await handleHealthCheck(registry, providers);
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.results).toHaveLength(3);

      const ollamaStatus = parsed.results.find((r: HealthStatus) => r.model_id === "test-ollama");
      const openaiStatus = parsed.results.find((r: HealthStatus) => r.model_id === "test-openai");

      expect(ollamaStatus.reachable).toBe(false);
      expect(ollamaStatus.error).toBe("timeout");
      expect(openaiStatus.reachable).toBe(true);
      expect(openaiStatus.latency_ms).toBe(80);
    });
  });

  describe("レスポンスフォーマット", () => {
    test("MCP tool response形式で返却", async () => {
      const registry = new ModelRegistry([testModels[0]]);
      const providers = new Map<string, ProviderAdapter>();
      providers.set("ollama", createHealthyProvider("ollama", 10));

      const result = await handleHealthCheck(registry, providers);

      expect(result.content[0].type).toBe("text");
      expect(() => JSON.parse(result.content[0].text)).not.toThrow();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveProperty("results");
      expect(Array.isArray(parsed.results)).toBe(true);
    });

    test("isErrorは設定されない（ヘルスチェック自体は常に成功）", async () => {
      const registry = new ModelRegistry([testModels[0]]);
      const providers = new Map<string, ProviderAdapter>();
      providers.set("ollama", createUnhealthyProvider("ollama", "error"));

      const result = await handleHealthCheck(registry, providers);

      // 個別モデルのエラーはresults内に含まれるが、ツール自体はエラーではない
      expect(result.isError).toBeUndefined();
    });
  });
});
