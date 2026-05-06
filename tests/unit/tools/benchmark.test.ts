/**
 * benchmark_model ツールハンドラのユニットテスト
 * Requirements: 8.1, 8.4, 8.7
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { handleBenchmarkModel, benchmarkModelSchema } from "@/tools/benchmark.js";
import { BenchmarkRunner } from "@/benchmark/runner.js";
import { BenchmarkStore } from "@/benchmark/store.js";
import { ModelRegistry } from "@/registry/model-registry.js";
import type { ProviderAdapter, GenerateRequest } from "@/providers/base.js";
import type { ModelEntry } from "@/config/types.js";
import type { UnifiedResponse, HealthStatus } from "@/types/response.js";

/** テスト用モックプロバイダ */
function createMockProvider(
  generateFn?: (req: GenerateRequest) => Promise<UnifiedResponse>,
): ProviderAdapter {
  return {
    provider: "ollama",
    generate: generateFn ?? (async () => ({
      text: "function fizzbuzz() { return 42; }",
      model_id: "test-ollama",
      provider: "ollama",
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    })),
    healthCheck: async (entry: ModelEntry): Promise<HealthStatus> => ({
      model_id: entry.id,
      provider: "ollama",
      reachable: true,
      latency_ms: 50,
    }),
  };
}

/** テスト用Ollamaモデルエントリ */
function createOllamaEntry(overrides?: Partial<ModelEntry>): ModelEntry {
  return {
    id: "test-ollama",
    provider: "ollama",
    endpoint: "http://localhost:11434",
    model_name: "llama3",
    capabilities: ["code_generation", "reasoning"],
    priority: 10,
    timeout_ms: 30000,
    ...overrides,
  } as ModelEntry;
}

describe("benchmarkModelSchema", () => {
  test("model_idは必須の文字列", () => {
    expect(benchmarkModelSchema.model_id).toBeDefined();
  });

  test("categoriesはoptionalな文字列配列", () => {
    expect(benchmarkModelSchema.categories).toBeDefined();
  });
});

describe("handleBenchmarkModel", () => {
  let tempDir: string;
  let store: BenchmarkStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "benchmark-tool-test-"));
    store = new BenchmarkStore(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("正常系", () => {
    test("ベンチマーク実行成功 → BenchmarkResult返却", async () => {
      const entry = createOllamaEntry();
      const registry = new ModelRegistry([entry]);
      const runner = new BenchmarkRunner(createMockProvider(), store, registry);

      const result = await handleBenchmarkModel(
        { model_id: "test-ollama" },
        runner,
      );

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe("text");

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.model_id).toBe("test-ollama");
      expect(parsed.timestamp).toBeTruthy();
      expect(parsed.categories).toBeDefined();
      expect(parsed.scores).toBeDefined();
    });

    test("カテゴリ指定でフィルタ実行", async () => {
      const entry = createOllamaEntry();
      const registry = new ModelRegistry([entry]);
      const runner = new BenchmarkRunner(createMockProvider(), store, registry);

      const result = await handleBenchmarkModel(
        { model_id: "test-ollama", categories: ["reasoning"] },
        runner,
      );

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.categories).toHaveLength(1);
      expect(parsed.categories[0].category).toBe("reasoning");
      expect(parsed.scores["reasoning"]).toBeDefined();
    });

    test("結果のscoresに各カテゴリスコアが含まれる", async () => {
      const entry = createOllamaEntry();
      const registry = new ModelRegistry([entry]);
      const runner = new BenchmarkRunner(createMockProvider(), store, registry);

      const result = await handleBenchmarkModel(
        { model_id: "test-ollama", categories: ["code_generation", "reasoning"] },
        runner,
      );

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.scores["code_generation"]).toBeDefined();
      expect(parsed.scores["reasoning"]).toBeDefined();
    });
  });

  describe("エラー系", () => {
    test("存在しないmodel_idでbenchmarkエラー返却", async () => {
      const entry = createOllamaEntry();
      const registry = new ModelRegistry([entry]);
      const runner = new BenchmarkRunner(createMockProvider(), store, registry);

      const result = await handleBenchmarkModel(
        { model_id: "nonexistent" },
        runner,
      );

      expect(result.isError).toBe(true);
      const error = JSON.parse(result.content[0].text);
      expect(error.error).toBe(true);
      expect(error.error_type).toBe("benchmark");
      expect(error.message).toContain("Model not found");
      expect(error.model_id).toBe("nonexistent");
    });

    test("no-benchmarkタグ付きモデルでbenchmarkエラー返却", async () => {
      const entry = createOllamaEntry({ tags: ["no-benchmark"] });
      const registry = new ModelRegistry([entry]);
      const runner = new BenchmarkRunner(createMockProvider(), store, registry);

      const result = await handleBenchmarkModel(
        { model_id: "test-ollama" },
        runner,
      );

      expect(result.isError).toBe(true);
      const error = JSON.parse(result.content[0].text);
      expect(error.error).toBe(true);
      expect(error.error_type).toBe("benchmark");
      expect(error.message).toContain("not benchmarkable");
      expect(error.model_id).toBe("test-ollama");
    });

    test("非Ollamaプロバイダでbenchmarkエラー返却", async () => {
      const entry: ModelEntry = {
        id: "test-openai",
        provider: "openai",
        endpoint: "https://api.openai.com/v1",
        model_name: "gpt-4o",
        capabilities: ["reasoning"],
        priority: 5,
        timeout_ms: 30000,
        auth: { api_key: "sk-test" },
      };
      const registry = new ModelRegistry([entry]);
      const runner = new BenchmarkRunner(createMockProvider(), store, registry);

      const result = await handleBenchmarkModel(
        { model_id: "test-openai" },
        runner,
      );

      expect(result.isError).toBe(true);
      const error = JSON.parse(result.content[0].text);
      expect(error.error).toBe(true);
      expect(error.error_type).toBe("benchmark");
      expect(error.message).toContain("not benchmarkable");
      expect(error.model_id).toBe("test-openai");
    });
  });

  describe("レスポンスフォーマット", () => {
    test("成功時のレスポンスにisErrorが含まれない", async () => {
      const entry = createOllamaEntry();
      const registry = new ModelRegistry([entry]);
      const runner = new BenchmarkRunner(createMockProvider(), store, registry);

      const result = await handleBenchmarkModel(
        { model_id: "test-ollama", categories: ["chat"] },
        runner,
      );

      expect(result.isError).toBeUndefined();
      expect(result.content[0].type).toBe("text");
      expect(() => JSON.parse(result.content[0].text)).not.toThrow();
    });

    test("エラー時のレスポンスにisError: trueが含まれる", async () => {
      const entry = createOllamaEntry();
      const registry = new ModelRegistry([entry]);
      const runner = new BenchmarkRunner(createMockProvider(), store, registry);

      const result = await handleBenchmarkModel(
        { model_id: "nonexistent" },
        runner,
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].type).toBe("text");
      expect(() => JSON.parse(result.content[0].text)).not.toThrow();
    });
  });
});
