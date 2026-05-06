/**
 * Provider基底モジュールのユニットテスト
 * resolveAuth, createAbortSignal のテスト
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { resolveAuth, createAbortSignal } from "@/providers/base.js";

describe("resolveAuth", () => {
  const originalEnv = { ...Bun.env };

  afterEach(() => {
    // テスト用に設定した環境変数をクリーンアップ
    delete Bun.env["TEST_API_KEY"];
    delete Bun.env["ANOTHER_KEY"];
  });

  test("api_key直接指定時はその値を返却", () => {
    const result = resolveAuth({ api_key: "sk-direct-key" });
    expect(result).toBe("sk-direct-key");
  });

  test("api_keyとenv_var両方指定時はapi_keyを優先", () => {
    Bun.env["TEST_API_KEY"] = "env-value";
    const result = resolveAuth({
      api_key: "direct-value",
      env_var: "TEST_API_KEY",
    });
    expect(result).toBe("direct-value");
  });

  test("env_var指定時は環境変数の値を返却", () => {
    Bun.env["TEST_API_KEY"] = "from-env";
    const result = resolveAuth({ env_var: "TEST_API_KEY" });
    expect(result).toBe("from-env");
  });

  test("env_var指定で環境変数が未設定の場合はundefined", () => {
    const result = resolveAuth({ env_var: "NONEXISTENT_VAR" });
    expect(result).toBeUndefined();
  });

  test("authがundefinedの場合はundefined", () => {
    const result = resolveAuth(undefined);
    expect(result).toBeUndefined();
  });

  test("authが空オブジェクトの場合はundefined", () => {
    const result = resolveAuth({});
    expect(result).toBeUndefined();
  });

  test("api_keyが空文字列の場合もその値を返却", () => {
    const result = resolveAuth({ api_key: "" });
    expect(result).toBe("");
  });
});

describe("createAbortSignal", () => {
  test("AbortSignalを返却", () => {
    const signal = createAbortSignal(5000);
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  test("生成直後はabortされていない", () => {
    const signal = createAbortSignal(10000);
    expect(signal.aborted).toBe(false);
  });

  test("タイムアウト後にabortされる", async () => {
    const signal = createAbortSignal(50);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(signal.aborted).toBe(true);
  });
});
