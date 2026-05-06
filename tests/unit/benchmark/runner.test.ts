import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { BenchmarkRunner, type BenchmarkRequest } from "@/benchmark/runner";
import { BenchmarkStore } from "@/benchmark/store";
import { ModelRegistry } from "@/registry/model-registry";
import type { ProviderAdapter, GenerateRequest } from "@/providers/base";
import type { ModelEntry } from "@/config/types";
import type { UnifiedResponse, HealthStatus } from "@/types/response";

function createMockProvider(
  generateFn?: (req: GenerateRequest) => Promise<UnifiedResponse>
): ProviderAdapter {
  return {
    provider: "ollama",
    generate: generateFn ?? (async (req) => ({
      text: "mock response",
      model_id: "test-model",
      provider: "ollama",
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    })),
    healthCheck: async (entry) => ({
      model_id: entry.id,
      provider: "ollama",
      reachable: true,
      latency_ms: 50,
    }),
  };
}

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

function createCloudEntry(overrides?: Partial<ModelEntry>): ModelEntry {
  return {
    id: "test-openai",
    provider: "openai",
    endpoint: "https://api.openai.com/v1",
    model_name: "gpt-4o",
    capabilities: ["code_generation", "reasoning"],
    priority: 5,
    timeout_ms: 30000,
    auth: { env_var: "OPENAI_API_KEY" },
    ...overrides,
  } as ModelEntry;
}

describe("BenchmarkRunner", () => {
  let tempDir: string;
  let store: BenchmarkStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "benchmark-runner-test-"));
    store = new BenchmarkStore(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("isBenchmarkable", () => {
    test("Ollamaプロバイダかつno-benchmarkタグなし → true", () => {
      const entry = createOllamaEntry();
      const registry = new ModelRegistry([entry]);
      const runner = new BenchmarkRunner(createMockProvider(), store, registry);

      expect(runner.isBenchmarkable(entry)).toBe(true);
    });

    test("Ollamaプロバイダでタグ空配列 → true", () => {
      const entry = createOllamaEntry({ tags: [] });
      const registry = new ModelRegistry([entry]);
      const runner = new BenchmarkRunner(createMockProvider(), store, registry);

      expect(runner.isBenchmarkable(entry)).toBe(true);
    });

    test("Ollamaプロバイダで他のタグあり → true", () => {
      const entry = createOllamaEntry({ tags: ["fast", "local"] });
      const registry = new ModelRegistry([entry]);
      const runner = new BenchmarkRunner(createMockProvider(), store, registry);

      expect(runner.isBenchmarkable(entry)).toBe(true);
    });

    test("Ollamaプロバイダでno-benchmarkタグあり → false", () => {
      const entry = createOllamaEntry({ tags: ["no-benchmark"] });
      const registry = new ModelRegistry([entry]);
      const runner = new BenchmarkRunner(createMockProvider(), store, registry);

      expect(runner.isBenchmarkable(entry)).toBe(false);
    });

    test("Ollamaプロバイダでno-benchmarkタグが他タグと混在 → false", () => {
      const entry = createOllamaEntry({ tags: ["fast", "no-benchmark", "local"] });
      const registry = new ModelRegistry([entry]);
      const runner = new BenchmarkRunner(createMockProvider(), store, registry);

      expect(runner.isBenchmarkable(entry)).toBe(false);
    });

    test("OpenAIプロバイダ → false", () => {
      const entry = createCloudEntry();
      const registry = new ModelRegistry([entry]);
      const runner = new BenchmarkRunner(createMockProvider(), store, registry);

      expect(runner.isBenchmarkable(entry)).toBe(false);
    });

    test("Anthropicプロバイダ → false", () => {
      const entry = createCloudEntry({ id: "test-anthropic", provider: "anthropic" });
      const registry = new ModelRegistry([entry]);
      const runner = new BenchmarkRunner(createMockProvider(), store, registry);

      expect(runner.isBenchmarkable(entry)).toBe(false);
    });

    test("Geminiプロバイダ → false", () => {
      const entry = createCloudEntry({ id: "test-gemini", provider: "gemini" });
      const registry = new ModelRegistry([entry]);
      const runner = new BenchmarkRunner(createMockProvider(), store, registry);

      expect(runner.isBenchmarkable(entry)).toBe(false);
    });
  });

  describe("run", () => {
    test("存在しないmodel_idでエラー", async () => {
      const entry = createOllamaEntry();
      const registry = new ModelRegistry([entry]);
      const runner = new BenchmarkRunner(createMockProvider(), store, registry);

      const request: BenchmarkRequest = { model_id: "nonexistent" };
      await expect(runner.run(request)).rejects.toThrow("Model not found: nonexistent");
    });

    test("ベンチマーク不可モデルでエラー", async () => {
      const entry = createOllamaEntry({ tags: ["no-benchmark"] });
      const registry = new ModelRegistry([entry]);
      const runner = new BenchmarkRunner(createMockProvider(), store, registry);

      const request: BenchmarkRequest = { model_id: "test-ollama" };
      await expect(runner.run(request)).rejects.toThrow("not benchmarkable");
    });

    test("非Ollamaプロバイダでベンチマーク不可エラー", async () => {
      const entry = createCloudEntry();
      const registry = new ModelRegistry([entry]);
      const runner = new BenchmarkRunner(createMockProvider(), store, registry);

      const request: BenchmarkRequest = { model_id: "test-openai" };
      await expect(runner.run(request)).rejects.toThrow("not benchmarkable");
    });

    test("全カテゴリでベンチマーク実行", async () => {
      const entry = createOllamaEntry();
      const registry = new ModelRegistry([entry]);
      const provider = createMockProvider(async (req) => ({
        text: "function fizzbuzz() { return 42; } hello interface type id name email sort return",
        model_id: "test-ollama",
        provider: "ollama",
        usage: { prompt_tokens: 10, completion_tokens: 50, total_tokens: 60 },
      }));
      const runner = new BenchmarkRunner(provider, store, registry);

      const result = await runner.run({ model_id: "test-ollama" });

      expect(result.model_id).toBe("test-ollama");
      expect(result.timestamp).toBeTruthy();
      expect(result.categories.length).toBeGreaterThan(0);
      expect(Object.keys(result.scores).length).toBe(result.categories.length);

      // 全カテゴリのスコアが0-100範囲内
      for (const cat of result.categories) {
        expect(cat.score).toBeGreaterThanOrEqual(0);
        expect(cat.score).toBeLessThanOrEqual(100);
        expect(cat.prompts_tested).toBeGreaterThan(0);
        expect(cat.avg_latency_ms).toBeGreaterThanOrEqual(0);
      }
    });

    test("カテゴリ指定でフィルタ実行", async () => {
      const entry = createOllamaEntry();
      const registry = new ModelRegistry([entry]);
      const provider = createMockProvider(async () => ({
        text: "42",
        model_id: "test-ollama",
        provider: "ollama",
        usage: {},
      }));
      const runner = new BenchmarkRunner(provider, store, registry);

      const result = await runner.run({
        model_id: "test-ollama",
        categories: ["reasoning"],
      });

      expect(result.categories).toHaveLength(1);
      expect(result.categories[0]!.category).toBe("reasoning");
      expect(result.scores["reasoning"]).toBeDefined();
      expect(result.scores["code_generation"]).toBeUndefined();
    });

    test("複数カテゴリ指定", async () => {
      const entry = createOllamaEntry();
      const registry = new ModelRegistry([entry]);
      const provider = createMockProvider(async () => ({
        text: "function hello() { return 42; }",
        model_id: "test-ollama",
        provider: "ollama",
        usage: {},
      }));
      const runner = new BenchmarkRunner(provider, store, registry);

      const result = await runner.run({
        model_id: "test-ollama",
        categories: ["code_generation", "reasoning"],
      });

      expect(result.categories).toHaveLength(2);
      const categoryNames = result.categories.map((c) => c.category).sort();
      expect(categoryNames).toEqual(["code_generation", "reasoning"]);
    });

    test("結果がストアに保存される", async () => {
      const entry = createOllamaEntry();
      const registry = new ModelRegistry([entry]);
      const provider = createMockProvider(async () => ({
        text: "hello world",
        model_id: "test-ollama",
        provider: "ollama",
        usage: {},
      }));
      const runner = new BenchmarkRunner(provider, store, registry);

      await runner.run({ model_id: "test-ollama", categories: ["chat"] });

      const saved = await store.load("test-ollama");
      expect(saved).toBeDefined();
      expect(saved!.model_id).toBe("test-ollama");
    });

    test("プロバイダエラー時はscore=0で記録", async () => {
      const entry = createOllamaEntry();
      const registry = new ModelRegistry([entry]);
      const provider = createMockProvider(async () => {
        throw new Error("Connection refused");
      });
      const runner = new BenchmarkRunner(provider, store, registry);

      const result = await runner.run({
        model_id: "test-ollama",
        categories: ["reasoning"],
      });

      // エラーでもthrowせず結果を返す
      expect(result.model_id).toBe("test-ollama");
      expect(result.categories[0]!.category).toBe("reasoning");
      // 全プロンプトがscore=0
      for (const detail of result.categories[0]!.details) {
        expect(detail.score).toBe(0);
        expect(detail.actual_output).toBe("");
      }
      expect(result.categories[0]!.score).toBe(0);
    });

    test("一部プロンプトのみエラーの場合、エラー分だけscore=0", async () => {
      const entry = createOllamaEntry();
      const registry = new ModelRegistry([entry]);
      let callCount = 0;
      const provider = createMockProvider(async () => {
        callCount++;
        if (callCount % 2 === 0) {
          throw new Error("Timeout");
        }
        return {
          text: "42 150 32 animal",
          model_id: "test-ollama",
          provider: "ollama",
          usage: {},
        };
      });
      const runner = new BenchmarkRunner(provider, store, registry);

      const result = await runner.run({
        model_id: "test-ollama",
        categories: ["reasoning"],
      });

      // 一部成功、一部失敗
      const details = result.categories[0]!.details;
      const hasSuccess = details.some((d) => d.score > 0);
      const hasFailure = details.some((d) => d.score === 0);
      expect(hasSuccess).toBe(true);
      expect(hasFailure).toBe(true);
    });

    test("結果のtimestampがISO 8601形式", async () => {
      const entry = createOllamaEntry();
      const registry = new ModelRegistry([entry]);
      const provider = createMockProvider(async () => ({
        text: "test",
        model_id: "test-ollama",
        provider: "ollama",
        usage: {},
      }));
      const runner = new BenchmarkRunner(provider, store, registry);

      const result = await runner.run({
        model_id: "test-ollama",
        categories: ["chat"],
      });

      // ISO 8601形式の検証
      const parsed = new Date(result.timestamp);
      expect(parsed.toISOString()).toBe(result.timestamp);
    });

    test("detailsにpromptとexpected_patternが記録される", async () => {
      const entry = createOllamaEntry();
      const registry = new ModelRegistry([entry]);
      const provider = createMockProvider(async () => ({
        text: "hello there",
        model_id: "test-ollama",
        provider: "ollama",
        usage: {},
      }));
      const runner = new BenchmarkRunner(provider, store, registry);

      const result = await runner.run({
        model_id: "test-ollama",
        categories: ["chat"],
      });

      for (const detail of result.categories[0]!.details) {
        expect(detail.prompt).toBeTruthy();
        expect(detail.expected_pattern).toBeTruthy();
        expect(detail.actual_output).toBe("hello there");
        expect(detail.latency_ms).toBeGreaterThanOrEqual(0);
      }
    });
  });
});
