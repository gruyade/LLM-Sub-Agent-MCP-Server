/**
 * MCPサーバ セットアップのユニットテスト
 */
import { describe, test, expect } from "bun:test";
import { createProviderMap, setupServer } from "@/index.js";
import { join } from "node:path";

describe("createProviderMap", () => {
  test("5プロバイダ全てが登録される", () => {
    const map = createProviderMap();
    expect(map.size).toBe(5);
    expect(map.has("ollama")).toBe(true);
    expect(map.has("openai")).toBe(true);
    expect(map.has("openai-compatible")).toBe(true);
    expect(map.has("anthropic")).toBe(true);
    expect(map.has("gemini")).toBe(true);
  });

  test("各プロバイダがProviderAdapterインターフェースを満たす", () => {
    const map = createProviderMap();
    for (const [name, adapter] of map) {
      expect(adapter.provider).toBe(name);
      expect(typeof adapter.generate).toBe("function");
      expect(typeof adapter.healthCheck).toBe("function");
    }
  });
});

describe("setupServer", () => {
  const fixtureDir = join(import.meta.dir, "fixtures");
  const validConfigPath = join(fixtureDir, "valid-config.json");

  test("有効なconfigでMcpServerインスタンスを返す", async () => {
    const server = await setupServer(validConfigPath);
    expect(server).toBeDefined();
    expect(server.server).toBeDefined();
  });

  test("存在しないconfigパスでエラーをthrow", async () => {
    await expect(setupServer("/nonexistent/config.json")).rejects.toThrow(
      "Config file not found"
    );
  });
});
