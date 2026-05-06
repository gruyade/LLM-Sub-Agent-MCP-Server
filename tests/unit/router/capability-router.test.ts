/**
 * CapabilityRouter ユニットテスト
 */
import { describe, test, expect } from "bun:test";
import {
  CapabilityRouter,
  computeEffectivePriority,
} from "@/router/capability-router.js";
import { ModelRegistry } from "@/registry/model-registry.js";
import type { ModelEntry } from "@/config/types.js";

/** テスト用ModelEntryヘルパー */
function createModel(overrides: Partial<ModelEntry> & { id: string }): ModelEntry {
  return {
    provider: "ollama",
    endpoint: "http://localhost:11434",
    model_name: "test-model",
    capabilities: ["code_generation"],
    priority: 0,
    timeout_ms: 30000,
    ...overrides,
  };
}

describe("computeEffectivePriority", () => {
  test("scores未定義時はpriorityをそのまま返却", () => {
    const model = createModel({ id: "m1", priority: 10 });
    expect(computeEffectivePriority(model, "code_generation")).toBe(10);
  });

  test("scoresに該当capabilityがない場合はpriorityをそのまま返却", () => {
    const model = createModel({
      id: "m1",
      priority: 10,
      scores: { reasoning: 80 },
    });
    expect(computeEffectivePriority(model, "code_generation")).toBe(10);
  });

  test("scoresに該当capabilityがある場合はpriority × (1 + score/100)", () => {
    const model = createModel({
      id: "m1",
      priority: 10,
      scores: { code_generation: 50 },
    });
    // 10 * (1 + 50/100) = 10 * 1.5 = 15
    expect(computeEffectivePriority(model, "code_generation")).toBe(15);
  });

  test("score=0の場合はpriorityと同値", () => {
    const model = createModel({
      id: "m1",
      priority: 10,
      scores: { code_generation: 0 },
    });
    // 10 * (1 + 0/100) = 10
    expect(computeEffectivePriority(model, "code_generation")).toBe(10);
  });

  test("score=100の場合はpriority × 2", () => {
    const model = createModel({
      id: "m1",
      priority: 10,
      scores: { code_generation: 100 },
    });
    // 10 * (1 + 100/100) = 10 * 2 = 20
    expect(computeEffectivePriority(model, "code_generation")).toBe(20);
  });
});

describe("CapabilityRouter", () => {
  describe("model_id指定ルーティング", () => {
    test("存在するmodel_id → 該当モデルを返却", () => {
      const models = [
        createModel({ id: "model-a", priority: 5 }),
        createModel({ id: "model-b", priority: 10 }),
      ];
      const registry = new ModelRegistry(models);
      const router = new CapabilityRouter(registry);

      const result = router.route({ model_id: "model-a" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.model.id).toBe("model-a");
      }
    });

    test("存在しないmodel_id → エラー返却", () => {
      const models = [createModel({ id: "model-a", priority: 5 })];
      const registry = new ModelRegistry(models);
      const router = new CapabilityRouter(registry);

      const result = router.route({ model_id: "nonexistent" });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("nonexistent");
      }
    });

    test("model_id指定時はcapabilityを無視", () => {
      const models = [
        createModel({
          id: "model-a",
          capabilities: ["reasoning"],
          priority: 5,
        }),
      ];
      const registry = new ModelRegistry(models);
      const router = new CapabilityRouter(registry);

      // model-aはcode_generationを持たないが、model_id指定なので返却される
      const result = router.route({
        model_id: "model-a",
        capability: "code_generation",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.model.id).toBe("model-a");
      }
    });
  });

  describe("capability指定ルーティング", () => {
    test("該当capabilityを持つモデルの中からpriority最高を選択", () => {
      const models = [
        createModel({
          id: "low",
          capabilities: ["code_generation"],
          priority: 5,
        }),
        createModel({
          id: "high",
          capabilities: ["code_generation"],
          priority: 10,
        }),
      ];
      const registry = new ModelRegistry(models);
      const router = new CapabilityRouter(registry);

      const result = router.route({ capability: "code_generation" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.model.id).toBe("high");
      }
    });

    test("scoresによる実効priority考慮", () => {
      const models = [
        createModel({
          id: "scored",
          capabilities: ["code_generation"],
          priority: 5,
          scores: { code_generation: 80 },
        }),
        createModel({
          id: "unscored",
          capabilities: ["code_generation"],
          priority: 8,
        }),
      ];
      const registry = new ModelRegistry(models);
      const router = new CapabilityRouter(registry);

      // scored: 5 * (1 + 80/100) = 5 * 1.8 = 9
      // unscored: 8
      const result = router.route({ capability: "code_generation" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.model.id).toBe("scored");
      }
    });

    test("同一実効priority時はmodel_id辞書順で選択", () => {
      const models = [
        createModel({
          id: "beta",
          capabilities: ["code_generation"],
          priority: 10,
        }),
        createModel({
          id: "alpha",
          capabilities: ["code_generation"],
          priority: 10,
        }),
      ];
      const registry = new ModelRegistry(models);
      const router = new CapabilityRouter(registry);

      const result = router.route({ capability: "code_generation" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.model.id).toBe("alpha");
      }
    });

    test("該当capabilityを持つモデルなし → エラー返却", () => {
      const models = [
        createModel({
          id: "model-a",
          capabilities: ["reasoning"],
          priority: 10,
        }),
      ];
      const registry = new ModelRegistry(models);
      const router = new CapabilityRouter(registry);

      const result = router.route({ capability: "translation" });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("translation");
      }
    });

    test("capabilityを持たないモデルは候補から除外", () => {
      const models = [
        createModel({
          id: "has-cap",
          capabilities: ["code_generation"],
          priority: 5,
        }),
        createModel({
          id: "no-cap",
          capabilities: ["reasoning"],
          priority: 100,
        }),
      ];
      const registry = new ModelRegistry(models);
      const router = new CapabilityRouter(registry);

      const result = router.route({ capability: "code_generation" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.model.id).toBe("has-cap");
      }
    });
  });

  describe("デフォルトルーティング（両方なし）", () => {
    test("priority最高のモデルを返却", () => {
      const models = [
        createModel({ id: "low", priority: 3 }),
        createModel({ id: "high", priority: 15 }),
        createModel({ id: "mid", priority: 8 }),
      ];
      const registry = new ModelRegistry(models);
      const router = new CapabilityRouter(registry);

      const result = router.route({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.model.id).toBe("high");
      }
    });

    test("同一priority時はmodel_id辞書順で選択", () => {
      const models = [
        createModel({ id: "zebra", priority: 10 }),
        createModel({ id: "apple", priority: 10 }),
      ];
      const registry = new ModelRegistry(models);
      const router = new CapabilityRouter(registry);

      const result = router.route({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.model.id).toBe("apple");
      }
    });
  });

  describe("スコアベースルーティング詳細", () => {
    test("スコア付きモデルがスコアなしモデルに勝つケース", () => {
      const models = [
        createModel({
          id: "local",
          capabilities: ["reasoning"],
          priority: 10,
          scores: { reasoning: 60 },
        }),
        createModel({
          id: "cloud",
          capabilities: ["reasoning"],
          priority: 15,
        }),
      ];
      const registry = new ModelRegistry(models);
      const router = new CapabilityRouter(registry);

      // local: 10 * (1 + 60/100) = 10 * 1.6 = 16
      // cloud: 15
      const result = router.route({ capability: "reasoning" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.model.id).toBe("local");
      }
    });

    test("スコアなしモデルがスコア付きモデルに勝つケース", () => {
      const models = [
        createModel({
          id: "local",
          capabilities: ["reasoning"],
          priority: 5,
          scores: { reasoning: 20 },
        }),
        createModel({
          id: "cloud",
          capabilities: ["reasoning"],
          priority: 10,
        }),
      ];
      const registry = new ModelRegistry(models);
      const router = new CapabilityRouter(registry);

      // local: 5 * (1 + 20/100) = 5 * 1.2 = 6
      // cloud: 10
      const result = router.route({ capability: "reasoning" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.model.id).toBe("cloud");
      }
    });

    test("複数モデルの実効priority比較", () => {
      const models = [
        createModel({
          id: "a",
          capabilities: ["code_generation"],
          priority: 10,
          scores: { code_generation: 78 },
        }),
        createModel({
          id: "b",
          capabilities: ["code_generation"],
          priority: 5,
        }),
        createModel({
          id: "c",
          capabilities: ["code_generation"],
          priority: 8,
          scores: { code_generation: 100 },
        }),
      ];
      const registry = new ModelRegistry(models);
      const router = new CapabilityRouter(registry);

      // a: 10 * (1 + 78/100) = 10 * 1.78 = 17.8
      // b: 5
      // c: 8 * (1 + 100/100) = 8 * 2 = 16
      const result = router.route({ capability: "code_generation" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.model.id).toBe("a");
      }
    });
  });
});
