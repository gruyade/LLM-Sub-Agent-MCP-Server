import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { BenchmarkStore, type BenchmarkResult } from "@/benchmark/store";

function createResult(modelId: string, overrides?: Partial<BenchmarkResult>): BenchmarkResult {
  return {
    model_id: modelId,
    timestamp: new Date().toISOString(),
    categories: [
      {
        category: "code_generation",
        score: 75,
        avg_latency_ms: 1200,
        prompts_tested: 4,
        details: [
          {
            prompt: "Write FizzBuzz",
            expected_pattern: "function|const",
            actual_output: "function fizzbuzz() {}",
            score: 100,
            latency_ms: 1000,
          },
          {
            prompt: "Write sort",
            expected_pattern: "sort|return",
            actual_output: "no code here",
            score: 0,
            latency_ms: 1400,
          },
        ],
      },
    ],
    scores: { code_generation: 75 },
    ...overrides,
  };
}

describe("BenchmarkStore", () => {
  let tempDir: string;
  let store: BenchmarkStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "benchmark-store-test-"));
    store = new BenchmarkStore(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("save", () => {
    test("新規結果を保存", async () => {
      const result = createResult("model-a");
      await store.save(result);

      const loaded = await store.load("model-a");
      expect(loaded).toEqual(result);
    });

    test("同一model_idの結果をupsert（置換）", async () => {
      const result1 = createResult("model-a", { timestamp: "2024-01-01T00:00:00Z" });
      const result2 = createResult("model-a", {
        timestamp: "2024-06-01T00:00:00Z",
        scores: { code_generation: 90 },
      });

      await store.save(result1);
      await store.save(result2);

      const all = await store.loadAll();
      expect(all).toHaveLength(1);
      expect(all[0]!.timestamp).toBe("2024-06-01T00:00:00Z");
      expect(all[0]!.scores.code_generation).toBe(90);
    });

    test("異なるmodel_idは別エントリとして保存", async () => {
      const resultA = createResult("model-a");
      const resultB = createResult("model-b");

      await store.save(resultA);
      await store.save(resultB);

      const all = await store.loadAll();
      expect(all).toHaveLength(2);
    });
  });

  describe("load", () => {
    test("存在するmodel_idの結果を返す", async () => {
      const result = createResult("model-x");
      await store.save(result);

      const loaded = await store.load("model-x");
      expect(loaded).toEqual(result);
    });

    test("存在しないmodel_idはundefinedを返す", async () => {
      const result = createResult("model-a");
      await store.save(result);

      const loaded = await store.load("nonexistent");
      expect(loaded).toBeUndefined();
    });

    test("ファイルが存在しない場合はundefinedを返す", async () => {
      const loaded = await store.load("any-model");
      expect(loaded).toBeUndefined();
    });
  });

  describe("loadAll", () => {
    test("全結果を返す", async () => {
      await store.save(createResult("model-a"));
      await store.save(createResult("model-b"));
      await store.save(createResult("model-c"));

      const all = await store.loadAll();
      expect(all).toHaveLength(3);
      expect(all.map((r) => r.model_id).sort()).toEqual(["model-a", "model-b", "model-c"]);
    });

    test("ファイルが存在しない場合は空配列を返す", async () => {
      const all = await store.loadAll();
      expect(all).toEqual([]);
    });
  });

  describe("ラウンドトリップ", () => {
    test("保存→読み込みで元のオブジェクトと等価", async () => {
      const result: BenchmarkResult = {
        model_id: "roundtrip-model",
        timestamp: "2024-03-15T10:30:00.000Z",
        categories: [
          {
            category: "reasoning",
            score: 80,
            avg_latency_ms: 500,
            prompts_tested: 3,
            details: [
              {
                prompt: "What is 15 + 27?",
                expected_pattern: "42",
                actual_output: "The answer is 42.",
                score: 100,
                latency_ms: 450,
              },
              {
                prompt: "Next in sequence: 2, 4, 8, 16, ?",
                expected_pattern: "32",
                actual_output: "32",
                score: 100,
                latency_ms: 550,
              },
            ],
          },
          {
            category: "chat",
            score: 60,
            avg_latency_ms: 300,
            prompts_tested: 2,
            details: [],
          },
        ],
        scores: { reasoning: 80, chat: 60 },
      };

      await store.save(result);
      const loaded = await store.load("roundtrip-model");
      expect(loaded).toEqual(result);
    });
  });
});
