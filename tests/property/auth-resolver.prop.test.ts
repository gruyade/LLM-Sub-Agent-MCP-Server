/**
 * 認証情報解決のプロパティテスト
 * Feature: llm-sub-agent-mcp-server, Property 7: 認証情報解決
 *
 * For any auth configuration:
 * (a) api_key直接指定がある場合はその値を返す
 * (b) env_var指定がある場合は対応する環境変数の値を返す
 * (c) どちらもない場合はundefinedを返す
 * (d) api_keyとenv_varの両方がある場合、api_keyが優先される
 *
 * **Validates: Requirements 3.5**
 */
import { describe, test, expect, afterEach } from "bun:test";
import * as fc from "fast-check";
import { resolveAuth } from "@/providers/base.js";

// テスト中に設定した環境変数を追跡し、afterEachでクリーンアップ
const envKeysToCleanup: string[] = [];

afterEach(() => {
  for (const key of envKeysToCleanup) {
    delete Bun.env[key];
  }
  envKeysToCleanup.length = 0;
});

// ─── Arbitrary Generators ───────────────────────────────────────────────────

/** 有効なapi_key文字列（非空） */
const apiKeyArb = fc.string({ minLength: 1, maxLength: 100 });

/** 環境変数名として有効な文字列 */
const envVarNameArb = fc
  .stringMatching(/^[A-Z][A-Z0-9_]{2,30}$/)
  .map((s) => `TEST_AUTH_${s}`);

/** 環境変数の値（非空） */
const envVarValueArb = fc.string({ minLength: 1, maxLength: 100 });

// ─── Property 7 ─────────────────────────────────────────────────────────────

describe("Feature: llm-sub-agent-mcp-server, Property 7: 認証情報解決", () => {
  test("(a) api_key直接指定がある場合、その値を返す", () => {
    fc.assert(
      fc.property(apiKeyArb, (apiKey) => {
        const result = resolveAuth({ api_key: apiKey });
        expect(result).toBe(apiKey);
      }),
      { numRuns: 100 },
    );
  });

  test("(b) env_var指定があり環境変数が存在する場合、環境変数の値を返す", () => {
    fc.assert(
      fc.property(
        envVarNameArb,
        envVarValueArb,
        (envVarName, envVarValue) => {
          // 環境変数を設定
          Bun.env[envVarName] = envVarValue;
          envKeysToCleanup.push(envVarName);

          try {
            const result = resolveAuth({ env_var: envVarName });
            expect(result).toBe(envVarValue);
          } finally {
            delete Bun.env[envVarName];
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  test("(c) api_keyもenv_varも指定なし（またはauth自体がundefined）の場合、undefinedを返す", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(undefined, {}, { api_key: undefined, env_var: undefined }),
        (auth) => {
          const result = resolveAuth(auth as any);
          expect(result).toBeUndefined();
        },
      ),
      { numRuns: 100 },
    );
  });

  test("(d) api_keyとenv_varの両方が指定されている場合、api_keyが優先される", () => {
    fc.assert(
      fc.property(
        apiKeyArb,
        envVarNameArb,
        envVarValueArb,
        (apiKey, envVarName, envVarValue) => {
          // 環境変数を設定（env_varが有効な状態にする）
          Bun.env[envVarName] = envVarValue;
          envKeysToCleanup.push(envVarName);

          try {
            const result = resolveAuth({
              api_key: apiKey,
              env_var: envVarName,
            });
            // api_keyが優先されること
            expect(result).toBe(apiKey);
          } finally {
            delete Bun.env[envVarName];
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  test("(b-2) env_var指定があるが環境変数が未設定の場合、undefinedを返す", () => {
    fc.assert(
      fc.property(envVarNameArb, (envVarName) => {
        // 環境変数が設定されていないことを確認
        delete Bun.env[envVarName];

        const result = resolveAuth({ env_var: envVarName });
        expect(result).toBeUndefined();
      }),
      { numRuns: 100 },
    );
  });
});
