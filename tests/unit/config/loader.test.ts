import { describe, test, expect, beforeAll, afterAll, spyOn } from "bun:test";
import { loadConfig, deduplicateModels } from "@/config/loader.js";
import { join } from "path";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import type { ModelEntry } from "@/config/types.js";

describe("loadConfig", () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "config-loader-test-"));
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  /** テスト用にJSONファイルを書き出すヘルパー */
  async function writeConfig(filename: string, content: unknown): Promise<string> {
    const filePath = join(tempDir, filename);
    await Bun.write(filePath, JSON.stringify(content));
    return filePath;
  }

  const validConfig = {
    models: [
      {
        id: "test-model",
        provider: "ollama",
        endpoint: "http://localhost:11434",
        model_name: "llama3",
        capabilities: ["chat"],
        priority: 10,
        timeout_ms: 30000,
      },
    ],
  };

  test("有効なConfigファイルを正常に読み込める", async () => {
    const filePath = await writeConfig("valid.json", validConfig);
    const config = await loadConfig(filePath);
    expect(config.models).toHaveLength(1);
    expect(config.models[0]!.id).toBe("test-model");
    expect(config.models[0]!.provider).toBe("ollama");
  });

  test("defaultsフィールドありで読み込める", async () => {
    const configWithDefaults = {
      ...validConfig,
      defaults: { timeout_ms: 60000 },
    };
    const filePath = await writeConfig("with-defaults.json", configWithDefaults);
    const config = await loadConfig(filePath);
    expect(config.defaults?.timeout_ms).toBe(60000);
  });

  test("ファイル不在時にパスを含むエラーメッセージをthrow", async () => {
    const nonExistentPath = join(tempDir, "nonexistent.json");
    await expect(loadConfig(nonExistentPath)).rejects.toThrow(
      `Config file not found: ${nonExistentPath}`
    );
  });

  test("JSONパース不能時にエラーメッセージをthrow", async () => {
    const filePath = join(tempDir, "invalid-json.json");
    await Bun.write(filePath, "{ invalid json content !!!");
    await expect(loadConfig(filePath)).rejects.toThrow(
      `Failed to parse config file: ${filePath}`
    );
  });

  test("バリデーションエラー時にフィールドパス情報を含むメッセージ", async () => {
    const invalidConfig = {
      models: [
        {
          id: "",
          provider: "invalid-provider",
          endpoint: "not-a-url",
          model_name: "",
          capabilities: [],
        },
      ],
    };
    const filePath = await writeConfig("invalid-schema.json", invalidConfig);
    try {
      await loadConfig(filePath);
      expect(true).toBe(false); // should not reach here
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      const msg = (e as Error).message;
      expect(msg).toContain("Config validation failed");
      expect(msg).toContain(filePath);
      // フィールドパス情報が含まれることを確認
      expect(msg).toMatch(/models\.\d+/);
    }
  });

  test("重複IDがある場合、最初のエントリのみ保持", async () => {
    const configWithDuplicates = {
      models: [
        {
          id: "dup-model",
          provider: "ollama",
          endpoint: "http://localhost:11434",
          model_name: "llama3",
          capabilities: ["chat"],
          priority: 10,
          timeout_ms: 30000,
        },
        {
          id: "dup-model",
          provider: "openai",
          endpoint: "https://api.openai.com/v1",
          model_name: "gpt-4o",
          capabilities: ["reasoning"],
          priority: 5,
          timeout_ms: 30000,
        },
        {
          id: "unique-model",
          provider: "anthropic",
          endpoint: "https://api.anthropic.com",
          model_name: "claude-sonnet",
          capabilities: ["summarization"],
          priority: 8,
          timeout_ms: 30000,
        },
      ],
    };
    const filePath = await writeConfig("duplicates.json", configWithDuplicates);

    // console.warnが呼ばれることを確認
    const warnSpy = spyOn(console, "warn");
    const config = await loadConfig(filePath);
    warnSpy.mockRestore();

    expect(config.models).toHaveLength(2);
    expect(config.models[0]!.id).toBe("dup-model");
    expect(config.models[0]!.provider).toBe("ollama"); // 最初のエントリ
    expect(config.models[1]!.id).toBe("unique-model");
  });

  test("重複ID検出時にconsole.warnが呼ばれる", async () => {
    const configWithDuplicates = {
      models: [
        {
          id: "dup",
          provider: "ollama",
          endpoint: "http://localhost:11434",
          model_name: "llama3",
          capabilities: ["chat"],
          priority: 10,
          timeout_ms: 30000,
        },
        {
          id: "dup",
          provider: "openai",
          endpoint: "https://api.openai.com/v1",
          model_name: "gpt-4o",
          capabilities: ["reasoning"],
          priority: 5,
          timeout_ms: 30000,
        },
      ],
    };
    const filePath = await writeConfig("dup-warn.json", configWithDuplicates);

    const warnSpy = spyOn(console, "warn");
    await loadConfig(filePath);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Duplicate model ID "dup"')
    );
    warnSpy.mockRestore();
  });

  test("複数モデルの有効なConfigを読み込める", async () => {
    const multiModelConfig = {
      models: [
        {
          id: "model-a",
          provider: "ollama",
          endpoint: "http://localhost:11434",
          model_name: "llama3",
          capabilities: ["chat", "reasoning"],
          priority: 10,
          timeout_ms: 60000,
        },
        {
          id: "model-b",
          provider: "openai",
          endpoint: "https://api.openai.com/v1",
          model_name: "gpt-4o",
          capabilities: ["code_generation"],
          priority: 5,
          timeout_ms: 30000,
          auth: { env_var: "OPENAI_API_KEY" },
        },
      ],
    };
    const filePath = await writeConfig("multi-model.json", multiModelConfig);
    const config = await loadConfig(filePath);
    expect(config.models).toHaveLength(2);
    expect(config.models[1]!.auth?.env_var).toBe("OPENAI_API_KEY");
  });
});

describe("deduplicateModels", () => {
  const makeModel = (id: string, provider: string = "ollama"): ModelEntry => ({
    id,
    provider: provider as ModelEntry["provider"],
    endpoint: "http://localhost:11434",
    model_name: "test",
    capabilities: ["chat"],
    priority: 0,
    timeout_ms: 30000,
  });

  test("重複なしの場合はそのまま返却", () => {
    const models = [makeModel("a"), makeModel("b"), makeModel("c")];
    const result = deduplicateModels(models);
    expect(result).toHaveLength(3);
  });

  test("重複ありの場合は最初のエントリのみ保持", () => {
    const models = [
      makeModel("a", "ollama"),
      makeModel("a", "openai"),
      makeModel("b"),
    ];
    const warnSpy = spyOn(console, "warn");
    const result = deduplicateModels(models);
    warnSpy.mockRestore();

    expect(result).toHaveLength(2);
    expect(result[0]!.id).toBe("a");
    expect(result[0]!.provider).toBe("ollama");
    expect(result[1]!.id).toBe("b");
  });

  test("空配列の場合は空配列を返却", () => {
    const result = deduplicateModels([]);
    expect(result).toHaveLength(0);
  });

  test("全て同一IDの場合は1つだけ保持", () => {
    const models = [makeModel("x"), makeModel("x"), makeModel("x")];
    const warnSpy = spyOn(console, "warn");
    const result = deduplicateModels(models);
    warnSpy.mockRestore();

    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("x");
  });
});
