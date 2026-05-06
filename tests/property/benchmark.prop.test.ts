/**
 * ベンチマークのプロパティテスト
 * Feature: llm-sub-agent-mcp-server
 *
 * Property 12: ベンチマークスコア範囲
 * Property 13: ベンチマーク結果永続化のラウンドトリップ
 * Property 15: no-benchmarkタグによるベンチマーク除外
 *
 * **Validates: Requirements 8.3, 8.7, 8.9**
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fc from "fast-check";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { BenchmarkRunner } from "@/benchmark/runner.js";
import { BenchmarkStore, type BenchmarkResult, type CategoryResult, type PromptResult } from "@/benchmark/store.js";
import { ModelRegistry } from "@/registry/model-registry.js";
import type { ProviderAdapter, GenerateRequest } from "@/providers/base.js";
import type { ModelEntry } from "@/config/types.js";
import type { UnifiedResponse } from "@/types/response.js";

// ─── Arbitrary Generators ───────────────────────────────────────────────────

/** 有効なcapabilityカテゴリ */
const categoryArb = fc.constantFrom(
  "code_generation",
  "reasoning",
  "summarization",
  "translation",
  "chat"
);

/** 非空のモデルID */
const modelIdArb = fc.stringMatching(/^[a-z][a-z0-9_-]{2,20}$/);

/** 0-100の整数スコア */
const scoreArb = fc.integer({ min: 0, max: 100 });

/** レイテンシ（正の整数） */
const latencyArb = fc.integer({ min: 0, max: 10000 });

/** PromptResult生成 */
const promptResultArb = fc.record({
  prompt: fc.string({ minLength: 1, maxLength: 100 }),
  expected_pattern: fc.string({ minLength: 1, maxLength: 50 }),
  actual_output: fc.string({ minLength: 0, maxLength: 200 }),
  score: scoreArb,
  latency_ms: latencyArb,
});

/** CategoryResult生成 */
const categoryResultArb = fc.tuple(categoryArb, fc.array(promptResultArb, { minLength: 1, maxLength: 5 }))
  .map(([category, details]) => {
    const totalLatency = details.reduce((sum, d) => sum + d.latency_ms, 0);
    const avgLatency = details.length > 0 ? Math.round(totalLatency / details.length) : 0;
    const totalScore = details.reduce((sum, d) => sum + d.score, 0);
    const score = details.length > 0 ? Math.round(totalScore / details.length) : 0;
    return {
      category,
      score,
      avg_latency_ms: avgLatency,
      prompts_tested: details.length,
      details,
    } as CategoryResult;
  });

/** BenchmarkResult生成（一意カテゴリ保証） */
const benchmarkResultArb = fc.tuple(
  modelIdArb,
  fc.uniqueArray(categoryResultArb, { minLength: 1, maxLength: 5, selector: (c) => c.category })
).map(([model_id, categories]) => {
  const scores: Record<string, number> = {};
  for (const cat of categories) {
    scores[cat.category] = cat.score;
  }
  return {
    model_id,
    timestamp: new Date().toISOString(),
    categories,
    scores,
  } as BenchmarkResult;
});

/** Ollamaモデルエントリ生成（ベンチマーク可能） */
const ollamaEntryArb = fc.record({
  id: modelIdArb,
  capabilities: fc.uniqueArray(categoryArb, { minLength: 1, maxLength: 5 }).filter((a) => a.length >= 1),
  priority: fc.integer({ min: 0, max: 100 }),
  timeout_ms: fc.integer({ min: 1000, max: 60000 }),
  tags: fc.oneof(
    fc.constant(undefined),
    fc.array(fc.stringMatching(/^[a-z][a-z0-9_-]{1,10}$/).filter((s) => s !== "no-benchmark"), { minLength: 0, maxLength: 3 })
  ),
}).map((entry) => {
  const result: ModelEntry = {
    id: entry.id,
    provider: "ollama",
    endpoint: "http://localhost:11434",
    model_name: "llama3",
    capabilities: entry.capabilities,
    priority: entry.priority,
    timeout_ms: entry.timeout_ms,
  } as ModelEntry;
  if (entry.tags !== undefined) {
    (result as any).tags = entry.tags;
  }
  return result;
});

/** タグ配列生成（必ず"no-benchmark"を含む） */
const tagsWithNoBenchmarkArb = fc
  .array(fc.stringMatching(/^[a-z][a-z0-9_-]{1,10}$/).filter((s) => s !== "no-benchmark"), { minLength: 0, maxLength: 3 })
  .map((tags) => {
    // ランダムな位置に"no-benchmark"を挿入
    const insertPos = Math.floor(Math.random() * (tags.length + 1));
    const result = [...tags];
    result.splice(insertPos, 0, "no-benchmark");
    return result;
  });

/** "no-benchmark"タグ付きモデルエントリ生成 */
const noBenchmarkEntryArb = fc.tuple(
  modelIdArb,
  fc.uniqueArray(categoryArb, { minLength: 1, maxLength: 5 }).filter((a) => a.length >= 1),
  fc.integer({ min: 0, max: 100 }),
  fc.integer({ min: 1000, max: 60000 }),
  tagsWithNoBenchmarkArb,
  fc.constantFrom("ollama", "openai", "openai-compatible", "anthropic", "gemini") as fc.Arbitrary<"ollama" | "openai" | "openai-compatible" | "anthropic" | "gemini">
).map(([id, capabilities, priority, timeout_ms, tags, provider]) => ({
  id,
  provider,
  endpoint: provider === "ollama" ? "http://localhost:11434" : "https://api.example.com/v1",
  model_name: "test-model",
  capabilities,
  priority,
  timeout_ms,
  tags,
} as ModelEntry));

/** モックプロバイダ生成（任意テキストを返す） */
function createMockProvider(textArb?: string): Map<string, ProviderAdapter> {
  const adapter: ProviderAdapter = {
    provider: "ollama",
    generate: async (req: GenerateRequest): Promise<UnifiedResponse> => ({
      text: textArb ?? "mock response with function and 42 and hello interface type",
      model_id: "test-model",
      provider: "ollama",
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    }),
    healthCheck: async (entry: ModelEntry) => ({
      model_id: entry.id,
      provider: "ollama",
      reachable: true,
      latency_ms: 50,
    }),
  };
  const compatAdapter: ProviderAdapter = {
    provider: "openai-compatible",
    generate: async (req: GenerateRequest): Promise<UnifiedResponse> => ({
      text: textArb ?? "mock response with function and 42 and hello interface type",
      model_id: "test-model",
      provider: "openai-compatible",
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    }),
    healthCheck: async (entry: ModelEntry) => ({
      model_id: entry.id,
      provider: "openai-compatible",
      reachable: true,
      latency_ms: 50,
    }),
  };
  const map = new Map<string, ProviderAdapter>();
  map.set("ollama", adapter);
  map.set("openai-compatible", compatAdapter);
  return map;
}

// ─── Property 12: ベンチマークスコア範囲 ─────────────────────────────────────

describe("Feature: llm-sub-agent-mcp-server, Property 12: ベンチマークスコア範囲", () => {
  let tempDir: string;
  let store: BenchmarkStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "benchmark-prop12-"));
    store = new BenchmarkStore(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("各カテゴリスコアが0-100の範囲内であり、scoresキーが対象カテゴリと一致する", async () => {
    await fc.assert(
      fc.asyncProperty(
        ollamaEntryArb,
        fc.uniqueArray(categoryArb, { minLength: 1, maxLength: 5 }).filter((a) => a.length >= 1),
        fc.string({ minLength: 1, maxLength: 200 }),
        async (entry, categories, responseText) => {
          // エントリのcapabilitiesにカテゴリを含める
          const modelEntry: ModelEntry = {
            ...entry,
            capabilities: [...new Set([...entry.capabilities, ...categories])],
          } as ModelEntry;

          const registry = new ModelRegistry([modelEntry]);
          const provider = createMockProvider(responseText);
          const runner = new BenchmarkRunner(provider, store, registry);

          const result = await runner.run({
            model_id: modelEntry.id,
            categories,
          });

          // 各カテゴリスコアが0-100の範囲内
          for (const cat of result.categories) {
            expect(cat.score).toBeGreaterThanOrEqual(0);
            expect(cat.score).toBeLessThanOrEqual(100);
            expect(Number.isInteger(cat.score)).toBe(true);
          }

          // scoresオブジェクトのキーが対象カテゴリと一致
          const scoreKeys = Object.keys(result.scores).sort();
          const expectedKeys = result.categories.map((c) => c.category).sort();
          expect(scoreKeys).toEqual(expectedKeys);

          // scoresの各値も0-100範囲内
          for (const score of Object.values(result.scores)) {
            expect(score).toBeGreaterThanOrEqual(0);
            expect(score).toBeLessThanOrEqual(100);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─── Property 13: ベンチマーク結果永続化のラウンドトリップ ────────────────────

describe("Feature: llm-sub-agent-mcp-server, Property 13: ベンチマーク結果永続化のラウンドトリップ", () => {
  let tempDir: string;
  let store: BenchmarkStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "benchmark-prop13-"));
    store = new BenchmarkStore(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("BenchmarkResultを保存→再読み込みし元と等価である", async () => {
    await fc.assert(
      fc.asyncProperty(benchmarkResultArb, async (result) => {
        // 保存
        await store.save(result);

        // 再読み込み
        const loaded = await store.load(result.model_id);

        // 等価性検証
        expect(loaded).toBeDefined();
        expect(loaded).toEqual(result);
      }),
      { numRuns: 100 }
    );
  });
});

// ─── Property 15: no-benchmarkタグによるベンチマーク除外 ─────────────────────

describe("Feature: llm-sub-agent-mcp-server, Property 15: no-benchmarkタグによるベンチマーク除外", () => {
  let tempDir: string;
  let store: BenchmarkStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "benchmark-prop15-"));
    store = new BenchmarkStore(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("tagsに'no-benchmark'を含むModelEntryでisBenchmarkable()がfalseを返す", () => {
    fc.assert(
      fc.property(noBenchmarkEntryArb, (entry) => {
        const registry = new ModelRegistry([entry]);
        const runner = new BenchmarkRunner(createMockProvider(), store, registry);

        expect(runner.isBenchmarkable(entry)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });
});
