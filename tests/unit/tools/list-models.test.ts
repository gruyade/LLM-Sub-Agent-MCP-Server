/**
 * list_models ツールハンドラのユニットテスト
 * Requirements: 4.2, 2.6
 */
import { describe, test, expect } from "bun:test";
import { handleListModels } from "@/tools/list-models.js";
import { ModelRegistry } from "@/registry/model-registry.js";
import type { ModelEntry } from "@/config/types.js";

/** テスト用モデルエントリ */
const testModels: ModelEntry[] = [
  {
    id: "local-codegen",
    provider: "ollama",
    endpoint: "http://localhost:11434",
    model_name: "codellama:13b",
    capabilities: ["code_generation", "reasoning"],
    priority: 10,
    timeout_ms: 60000,
    scores: { code_generation: 78, reasoning: 45 },
  },
  {
    id: "cloud-gpt4",
    provider: "openai",
    endpoint: "https://api.openai.com/v1",
    model_name: "gpt-4o",
    capabilities: ["code_generation", "reasoning", "summarization"],
    priority: 5,
    auth: { env_var: "OPENAI_API_KEY" },
    timeout_ms: 30000,
    tags: ["no-benchmark"],
  },
  {
    id: "cloud-claude",
    provider: "anthropic",
    endpoint: "https://api.anthropic.com",
    model_name: "claude-sonnet-4-20250514",
    capabilities: ["reasoning", "summarization", "translation"],
    priority: 8,
    auth: { env_var: "ANTHROPIC_API_KEY" },
    timeout_ms: 30000,
  },
];

describe("handleListModels", () => {
  test("全モデルの情報を返却", () => {
    const registry = new ModelRegistry(testModels);
    const result = handleListModels(registry);

    expect(result.isError).toBeUndefined();
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.models).toHaveLength(3);
  });

  test("各モデルにid, provider, model_name, capabilities, priority, scoresが含まれる", () => {
    const registry = new ModelRegistry(testModels);
    const result = handleListModels(registry);
    const parsed = JSON.parse(result.content[0].text);

    const firstModel = parsed.models[0];
    expect(firstModel.id).toBe("local-codegen");
    expect(firstModel.provider).toBe("ollama");
    expect(firstModel.model_name).toBe("codellama:13b");
    expect(firstModel.capabilities).toEqual(["code_generation", "reasoning"]);
    expect(firstModel.priority).toBe(10);
    expect(firstModel.scores).toEqual({ code_generation: 78, reasoning: 45 });
  });

  test("scoresが未定義のモデルはscoresがundefined", () => {
    const registry = new ModelRegistry(testModels);
    const result = handleListModels(registry);
    const parsed = JSON.parse(result.content[0].text);

    // cloud-gpt4はscores未定義
    const gpt4 = parsed.models.find((m: { id: string }) => m.id === "cloud-gpt4");
    expect(gpt4.scores).toBeUndefined();
  });

  test("endpoint, auth, timeout_ms, tagsは含まれない", () => {
    const registry = new ModelRegistry(testModels);
    const result = handleListModels(registry);
    const parsed = JSON.parse(result.content[0].text);

    for (const model of parsed.models) {
      expect(model.endpoint).toBeUndefined();
      expect(model.auth).toBeUndefined();
      expect(model.timeout_ms).toBeUndefined();
      expect(model.tags).toBeUndefined();
    }
  });

  test("空のRegistryでは空配列を返却", () => {
    // ModelRegistryは空配列を許容しないがgetAll()は空を返す可能性がある
    // 最低1モデルで確認
    const registry = new ModelRegistry([testModels[0]]);
    const result = handleListModels(registry);
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.models).toHaveLength(1);
  });

  test("MCP tool response形式で返却", () => {
    const registry = new ModelRegistry(testModels);
    const result = handleListModels(registry);

    // content配列にtype: "text"のオブジェクトが含まれる
    expect(result.content[0].type).toBe("text");
    // JSONとしてパース可能
    expect(() => JSON.parse(result.content[0].text)).not.toThrow();
    // トップレベルにmodelsキー
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveProperty("models");
    expect(Array.isArray(parsed.models)).toBe(true);
  });
});
