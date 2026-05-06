import { describe, test, expect } from "bun:test";
import { ModelEntrySchema, ConfigSchema } from "@/config/schema.js";

describe("ModelEntrySchema", () => {
  const validEntry = {
    id: "local-codegen",
    provider: "ollama" as const,
    endpoint: "http://localhost:11434",
    model_name: "codellama:13b",
    capabilities: ["code_generation", "reasoning"],
    priority: 10,
    timeout_ms: 60000,
  };

  test("有効なエントリをパースできる", () => {
    const result = ModelEntrySchema.parse(validEntry);
    expect(result.id).toBe("local-codegen");
    expect(result.provider).toBe("ollama");
    expect(result.capabilities).toEqual(["code_generation", "reasoning"]);
  });

  test("optionalフィールドなしでもパースできる", () => {
    const result = ModelEntrySchema.parse(validEntry);
    expect(result.auth).toBeUndefined();
    expect(result.scores).toBeUndefined();
    expect(result.tags).toBeUndefined();
  });

  test("optionalフィールドありでパースできる", () => {
    const entry = {
      ...validEntry,
      auth: { env_var: "OPENAI_API_KEY" },
      scores: { code_generation: 78, reasoning: 45 },
      tags: ["no-benchmark"],
    };
    const result = ModelEntrySchema.parse(entry);
    expect(result.auth).toEqual({ env_var: "OPENAI_API_KEY" });
    expect(result.scores).toEqual({ code_generation: 78, reasoning: 45 });
    expect(result.tags).toEqual(["no-benchmark"]);
  });

  test("priorityのデフォルト値は0", () => {
    const { priority, ...withoutPriority } = validEntry;
    const result = ModelEntrySchema.parse(withoutPriority);
    expect(result.priority).toBe(0);
  });

  test("timeout_msのデフォルト値は30000", () => {
    const { timeout_ms, ...withoutTimeout } = validEntry;
    const result = ModelEntrySchema.parse(withoutTimeout);
    expect(result.timeout_ms).toBe(30000);
  });

  test("無効なproviderでエラー", () => {
    const invalid = { ...validEntry, provider: "invalid" };
    expect(() => ModelEntrySchema.parse(invalid)).toThrow();
  });

  test("空のcapabilitiesでエラー", () => {
    const invalid = { ...validEntry, capabilities: [] };
    expect(() => ModelEntrySchema.parse(invalid)).toThrow();
  });

  test("空のidでエラー", () => {
    const invalid = { ...validEntry, id: "" };
    expect(() => ModelEntrySchema.parse(invalid)).toThrow();
  });

  test("無効なendpoint URLでエラー", () => {
    const invalid = { ...validEntry, endpoint: "not-a-url" };
    expect(() => ModelEntrySchema.parse(invalid)).toThrow();
  });

  test("scoresの値が0-100の範囲外でエラー", () => {
    const invalid = { ...validEntry, scores: { code_generation: 101 } };
    expect(() => ModelEntrySchema.parse(invalid)).toThrow();
  });

  test("5つのproviderすべてが有効", () => {
    for (const provider of ["ollama", "openai", "openai-compatible", "anthropic", "gemini"]) {
      const entry = { ...validEntry, provider };
      expect(() => ModelEntrySchema.parse(entry)).not.toThrow();
    }
  });
});

describe("ConfigSchema", () => {
  const validConfig = {
    models: [
      {
        id: "test-model",
        provider: "ollama" as const,
        endpoint: "http://localhost:11434",
        model_name: "llama3",
        capabilities: ["chat"],
      },
    ],
  };

  test("有効なConfigをパースできる", () => {
    const result = ConfigSchema.parse(validConfig);
    expect(result.models).toHaveLength(1);
    expect(result.defaults).toBeUndefined();
  });

  test("defaultsありでパースできる", () => {
    const config = { ...validConfig, defaults: { timeout_ms: 60000 } };
    const result = ConfigSchema.parse(config);
    expect(result.defaults?.timeout_ms).toBe(60000);
  });

  test("空のmodels配列でエラー", () => {
    const invalid = { models: [] };
    expect(() => ConfigSchema.parse(invalid)).toThrow();
  });
});
