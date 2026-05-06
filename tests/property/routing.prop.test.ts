/**
 * ルーティングのプロパティテスト
 * Feature: llm-sub-agent-mcp-server
 *
 * Property 3: Capabilityルーティングは実効priority最高のモデルを選択
 * Property 4: 存在しないcapabilityでエラー
 * Property 5: model_id指定で直接転送
 * Property 6: デフォルトモデルはpriority最高
 * Property 14: スコア付きルーティングの単調性
 *
 * **Validates: Requirements 2.2, 2.3, 2.4, 2.5, 4.4, 8.5**
 */
import { describe, test, expect } from "bun:test";
import * as fc from "fast-check";
import {
  CapabilityRouter,
  computeEffectivePriority,
} from "@/router/capability-router.js";
import { ModelRegistry } from "@/registry/model-registry.js";
import type { ModelEntry } from "@/config/types.js";

// ─── Arbitrary Generators ───────────────────────────────────────────────────

/** 有効なprovider値 */
const providerArb = fc.constantFrom(
  "ollama",
  "openai",
  "anthropic",
  "gemini",
) as fc.Arbitrary<"ollama" | "openai" | "anthropic" | "gemini">;

/** 有効なURL文字列 */
const urlArb = fc.constantFrom(
  "http://localhost:11434",
  "https://api.openai.com/v1",
  "https://api.anthropic.com",
  "https://generativelanguage.googleapis.com/v1beta",
);

/** 非空文字列（ID用） */
const nonEmptyStringArb = fc
  .stringMatching(/^[a-zA-Z][a-zA-Z0-9_-]{0,20}$/)
  .filter((s) => s.length >= 1);

/** capability文字列 */
const capabilityArb = fc.constantFrom(
  "code_generation",
  "reasoning",
  "summarization",
  "translation",
  "chat",
);

/** capabilities配列（1つ以上） */
const capabilitiesArb = fc
  .uniqueArray(capabilityArb, { minLength: 1, maxLength: 5 })
  .filter((arr) => arr.length >= 1);

/** scores objectの生成 */
const scoresArb = fc.oneof(
  fc.constant(undefined),
  fc
    .uniqueArray(
      fc.tuple(capabilityArb, fc.integer({ min: 0, max: 100 })),
      { minLength: 1, maxLength: 5, selector: ([k]) => k },
    )
    .map((entries) => Object.fromEntries(entries)),
);

/** 有効なModelEntryの生成（idは外部から注入） */
const modelEntryWithIdArb = (id: string) =>
  fc
    .record({
      provider: providerArb,
      endpoint: urlArb,
      model_name: nonEmptyStringArb,
      capabilities: capabilitiesArb,
      priority: fc.integer({ min: 0, max: 1000 }),
      timeout_ms: fc.integer({ min: 1, max: 300000 }),
      scores: scoresArb,
    })
    .map(
      (entry) =>
        ({
          id,
          provider: entry.provider,
          endpoint: entry.endpoint,
          model_name: entry.model_name,
          capabilities: entry.capabilities,
          priority: entry.priority,
          timeout_ms: entry.timeout_ms,
          ...(entry.scores !== undefined ? { scores: entry.scores } : {}),
        }) as ModelEntry,
    );

/** 一意なIDを持つModelEntry配列の生成（1つ以上） */
const uniqueModelsArb = fc
  .uniqueArray(nonEmptyStringArb, { minLength: 1, maxLength: 10 })
  .filter((ids) => ids.length >= 1)
  .chain((uniqueIds) =>
    fc.tuple(...uniqueIds.map((id) => modelEntryWithIdArb(id))),
  );

// ─── Property 3 ─────────────────────────────────────────────────────────────

describe("Feature: llm-sub-agent-mcp-server, Property 3: Capabilityルーティングは実効priority最高のモデルを選択", () => {
  /**
   * 少なくとも1つのモデルが指定capabilityを持つ状態を生成
   */
  const modelsWithCapabilityArb = fc
    .uniqueArray(nonEmptyStringArb, { minLength: 1, maxLength: 10 })
    .filter((ids) => ids.length >= 1)
    .chain((uniqueIds) =>
      fc.tuple(
        fc.tuple(...uniqueIds.map((id) => modelEntryWithIdArb(id))),
        capabilityArb,
      ),
    )
    .chain(([models, targetCapability]) => {
      // 少なくとも1つのモデルがtargetCapabilityを持つことを保証
      const hasCapability = models.some((m) =>
        m.capabilities.includes(targetCapability),
      );
      if (hasCapability) {
        return fc.constant({ models, targetCapability });
      }
      // 持っていない場合、最初のモデルにcapabilityを追加
      const adjusted = [...models];
      adjusted[0] = {
        ...adjusted[0]!,
        capabilities: [
          ...new Set([...adjusted[0]!.capabilities, targetCapability]),
        ],
      };
      return fc.constant({ models: adjusted, targetCapability });
    });

  test("該当capabilityを持つモデルが存在する場合、ルーティング結果は実効priority最大のモデル", () => {
    fc.assert(
      fc.property(modelsWithCapabilityArb, ({ models, targetCapability }) => {
        const registry = new ModelRegistry(models);
        const router = new CapabilityRouter(registry);

        const result = router.route({ capability: targetCapability });

        // (a) 成功すること
        expect(result.success).toBe(true);
        if (!result.success) return;

        // (b) 選択されたモデルが指定capabilityを持つこと
        expect(result.model.capabilities).toContain(targetCapability);

        // (c) 実効priority最大であること
        const candidates = models.filter((m) =>
          m.capabilities.includes(targetCapability),
        );
        const maxEffectivePriority = Math.max(
          ...candidates.map((m) =>
            computeEffectivePriority(m, targetCapability),
          ),
        );
        const selectedEffectivePriority = computeEffectivePriority(
          result.model,
          targetCapability,
        );
        expect(selectedEffectivePriority).toBe(maxEffectivePriority);
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Property 4 ─────────────────────────────────────────────────────────────

describe("Feature: llm-sub-agent-mcp-server, Property 4: 存在しないcapabilityでエラー", () => {
  /**
   * どのモデルも持たないcapabilityを生成
   */
  const modelsWithoutCapabilityArb = uniqueModelsArb.chain((models) => {
    // 全モデルのcapabilitiesを収集
    const allCapabilities = new Set(models.flatMap((m) => m.capabilities));
    // 存在しないcapabilityを生成
    const missingCapabilityArb = nonEmptyStringArb.filter(
      (cap) => !allCapabilities.has(cap),
    );
    return fc.tuple(fc.constant(models), missingCapabilityArb);
  });

  test("該当capabilityを持つモデルが存在しない場合、エラーレスポンス返却", () => {
    fc.assert(
      fc.property(
        modelsWithoutCapabilityArb,
        ([models, missingCapability]) => {
          const registry = new ModelRegistry(models);
          const router = new CapabilityRouter(registry);

          const result = router.route({ capability: missingCapability });

          expect(result.success).toBe(false);
          if (result.success) return;
          expect(result.error).toContain(missingCapability);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 5 ─────────────────────────────────────────────────────────────

describe("Feature: llm-sub-agent-mcp-server, Property 5: model_id指定で直接転送", () => {
  test("登録済みmodel_idを指定した場合、該当モデルが返却されcapabilityは無視", () => {
    fc.assert(
      fc.property(
        uniqueModelsArb.chain((models) =>
          fc.tuple(
            fc.constant(models),
            // 登録済みモデルからランダムに1つ選択
            fc.integer({ min: 0, max: models.length - 1 }),
            // 任意のcapability（無視されるはず）
            fc.option(capabilityArb, { nil: undefined }),
          ),
        ),
        ([models, selectedIndex, capability]) => {
          const registry = new ModelRegistry(models);
          const router = new CapabilityRouter(registry);
          const targetModel = models[selectedIndex]!;

          const result = router.route({
            model_id: targetModel.id,
            capability,
          });

          expect(result.success).toBe(true);
          if (!result.success) return;
          expect(result.model.id).toBe(targetModel.id);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 6 ─────────────────────────────────────────────────────────────

describe("Feature: llm-sub-agent-mcp-server, Property 6: デフォルトモデルはpriority最高", () => {
  test("capabilityもmodel_idも指定なしの場合、priority最大のモデルが選択", () => {
    fc.assert(
      fc.property(uniqueModelsArb, (models) => {
        const registry = new ModelRegistry(models);
        const router = new CapabilityRouter(registry);

        const result = router.route({});

        expect(result.success).toBe(true);
        if (!result.success) return;

        // 全モデル中のpriority最大値
        const maxPriority = Math.max(...models.map((m) => m.priority));
        expect(result.model.priority).toBe(maxPriority);
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Property 14 ────────────────────────────────────────────────────────────

describe("Feature: llm-sub-agent-mcp-server, Property 14: スコア付きルーティングの単調性", () => {
  /**
   * 同一priority・同一capabilityで異なるスコアを持つ2モデルを生成
   */
  const twoModelsWithDifferentScoresArb = fc
    .record({
      priority: fc.integer({ min: 1, max: 1000 }),
      capability: capabilityArb,
      scoreA: fc.integer({ min: 0, max: 100 }),
      scoreB: fc.integer({ min: 0, max: 100 }),
      idA: fc.constant("model-a"),
      idB: fc.constant("model-b"),
    })
    .filter((r) => r.scoreA !== r.scoreB)
    .map((r) => {
      const modelA: ModelEntry = {
        id: r.idA,
        provider: "ollama",
        endpoint: "http://localhost:11434",
        model_name: "test-a",
        capabilities: [r.capability],
        priority: r.priority,
        timeout_ms: 30000,
        scores: { [r.capability]: r.scoreA },
      };
      const modelB: ModelEntry = {
        id: r.idB,
        provider: "ollama",
        endpoint: "http://localhost:11434",
        model_name: "test-b",
        capabilities: [r.capability],
        priority: r.priority,
        timeout_ms: 30000,
        scores: { [r.capability]: r.scoreB },
      };
      return {
        models: [modelA, modelB],
        capability: r.capability,
        higherScoreId: r.scoreA > r.scoreB ? r.idA : r.idB,
      };
    });

  test("同一priority・同一capabilityの2モデルで、スコアが高い方が常に選択", () => {
    fc.assert(
      fc.property(
        twoModelsWithDifferentScoresArb,
        ({ models, capability, higherScoreId }) => {
          const registry = new ModelRegistry(models);
          const router = new CapabilityRouter(registry);

          const result = router.route({ capability });

          expect(result.success).toBe(true);
          if (!result.success) return;
          expect(result.model.id).toBe(higherScoreId);
        },
      ),
      { numRuns: 100 },
    );
  });
});
