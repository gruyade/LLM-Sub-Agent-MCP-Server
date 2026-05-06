import { describe, test, expect } from "bun:test";
import { ModelRegistry } from "@/registry/model-registry.js";
import type { ModelEntry } from "@/config/types.js";

/** テスト用ModelEntryファクトリ */
function makeModel(overrides: Partial<ModelEntry> & { id: string }): ModelEntry {
  return {
    provider: "ollama",
    endpoint: "http://localhost:11434",
    model_name: "test-model",
    capabilities: ["chat"],
    priority: 0,
    timeout_ms: 30000,
    ...overrides,
  };
}

describe("ModelRegistry", () => {
  describe("getAll", () => {
    test("全モデルを返却", () => {
      const models = [
        makeModel({ id: "a", priority: 5 }),
        makeModel({ id: "b", priority: 10 }),
        makeModel({ id: "c", priority: 3 }),
      ];
      const registry = new ModelRegistry(models);
      const result = registry.getAll();

      expect(result).toHaveLength(3);
      expect(result.map((m) => m.id)).toEqual(["a", "b", "c"]);
    });

    test("空配列で構築した場合は空配列を返却", () => {
      const registry = new ModelRegistry([]);
      expect(registry.getAll()).toHaveLength(0);
    });

    test("返却値の変更が内部状態に影響しない", () => {
      const models = [makeModel({ id: "a" })];
      const registry = new ModelRegistry(models);

      const result = registry.getAll();
      result.push(makeModel({ id: "injected" }));

      expect(registry.getAll()).toHaveLength(1);
    });

    test("コンストラクタに渡した配列の変更が内部状態に影響しない", () => {
      const models = [makeModel({ id: "a" })];
      const registry = new ModelRegistry(models);

      models.push(makeModel({ id: "injected" }));

      expect(registry.getAll()).toHaveLength(1);
    });
  });

  describe("getById", () => {
    test("存在するIDでモデルを返却", () => {
      const models = [
        makeModel({ id: "model-1", model_name: "llama3" }),
        makeModel({ id: "model-2", model_name: "gpt-4o" }),
      ];
      const registry = new ModelRegistry(models);

      const result = registry.getById("model-2");
      expect(result).toBeDefined();
      expect(result!.id).toBe("model-2");
      expect(result!.model_name).toBe("gpt-4o");
    });

    test("存在しないIDでundefinedを返却", () => {
      const models = [makeModel({ id: "model-1" })];
      const registry = new ModelRegistry(models);

      expect(registry.getById("nonexistent")).toBeUndefined();
    });

    test("空レジストリでundefinedを返却", () => {
      const registry = new ModelRegistry([]);
      expect(registry.getById("any")).toBeUndefined();
    });
  });

  describe("findByCapability", () => {
    test("指定capabilityを持つモデルのみ返却", () => {
      const models = [
        makeModel({ id: "a", capabilities: ["chat", "reasoning"] }),
        makeModel({ id: "b", capabilities: ["code_generation"] }),
        makeModel({ id: "c", capabilities: ["chat", "summarization"] }),
      ];
      const registry = new ModelRegistry(models);

      const result = registry.findByCapability("chat");
      expect(result).toHaveLength(2);
      expect(result.map((m) => m.id)).toContain("a");
      expect(result.map((m) => m.id)).toContain("c");
    });

    test("priority降順でソート", () => {
      const models = [
        makeModel({ id: "low", capabilities: ["chat"], priority: 3 }),
        makeModel({ id: "high", capabilities: ["chat"], priority: 10 }),
        makeModel({ id: "mid", capabilities: ["chat"], priority: 7 }),
      ];
      const registry = new ModelRegistry(models);

      const result = registry.findByCapability("chat");
      expect(result.map((m) => m.id)).toEqual(["high", "mid", "low"]);
    });

    test("同一priorityの場合はmodel_id辞書順", () => {
      const models = [
        makeModel({ id: "charlie", capabilities: ["chat"], priority: 5 }),
        makeModel({ id: "alpha", capabilities: ["chat"], priority: 5 }),
        makeModel({ id: "bravo", capabilities: ["chat"], priority: 5 }),
      ];
      const registry = new ModelRegistry(models);

      const result = registry.findByCapability("chat");
      expect(result.map((m) => m.id)).toEqual(["alpha", "bravo", "charlie"]);
    });

    test("該当capabilityを持つモデルがない場合は空配列", () => {
      const models = [
        makeModel({ id: "a", capabilities: ["chat"] }),
        makeModel({ id: "b", capabilities: ["reasoning"] }),
      ];
      const registry = new ModelRegistry(models);

      expect(registry.findByCapability("translation")).toHaveLength(0);
    });

    test("空レジストリで空配列を返却", () => {
      const registry = new ModelRegistry([]);
      expect(registry.findByCapability("chat")).toHaveLength(0);
    });
  });

  describe("getDefault", () => {
    test("priority最高のモデルを返却", () => {
      const models = [
        makeModel({ id: "low", priority: 3 }),
        makeModel({ id: "high", priority: 10 }),
        makeModel({ id: "mid", priority: 7 }),
      ];
      const registry = new ModelRegistry(models);

      const result = registry.getDefault();
      expect(result.id).toBe("high");
    });

    test("同一priorityの場合はmodel_id辞書順で先頭を返却", () => {
      const models = [
        makeModel({ id: "charlie", priority: 10 }),
        makeModel({ id: "alpha", priority: 10 }),
        makeModel({ id: "bravo", priority: 10 }),
      ];
      const registry = new ModelRegistry(models);

      const result = registry.getDefault();
      expect(result.id).toBe("alpha");
    });

    test("モデルが1つの場合はそのモデルを返却", () => {
      const models = [makeModel({ id: "only-one", priority: 5 })];
      const registry = new ModelRegistry(models);

      expect(registry.getDefault().id).toBe("only-one");
    });

    test("空レジストリでエラーをthrow", () => {
      const registry = new ModelRegistry([]);
      expect(() => registry.getDefault()).toThrow("No models registered");
    });
  });
});
