/**
 * Property 11: Config_Fileラウンドトリップ
 * Feature: llm-sub-agent-mcp-server, Property 11: Config_Fileラウンドトリップ
 *
 * 有効なConfigオブジェクトをJSON.stringify→JSON.parse→スキーマバリデーションし、
 * 元と等価であることを検証
 *
 * **Validates: Requirements 7.4**
 */
import { describe, test, expect } from "bun:test";
import * as fc from "fast-check";
import { ConfigSchema, ModelEntrySchema } from "@/config/schema.js";

/** 有効なprovider値の生成 */
const providerArb = fc.constantFrom(
  "ollama",
  "openai",
  "anthropic",
  "gemini"
) as fc.Arbitrary<"ollama" | "openai" | "anthropic" | "gemini">;

/** 有効なURL文字列の生成 */
const urlArb = fc.oneof(
  fc.constant("http://localhost:11434"),
  fc.constant("https://api.openai.com/v1"),
  fc.constant("https://api.anthropic.com"),
  fc.constant("https://generativelanguage.googleapis.com/v1beta"),
  fc.tuple(
    fc.constantFrom("http", "https"),
    fc.stringMatching(/^[a-z][a-z0-9-]{0,10}$/),
    fc.constantFrom(".com", ".io", ".dev", ".local"),
    fc.constantFrom("", "/v1", "/api", "/v1beta")
  ).map(([scheme, host, tld, path]) => `${scheme}://${host}${tld}${path}`)
);

/** 非空文字列の生成 */
const nonEmptyStringArb = fc
  .stringMatching(/^[a-zA-Z][a-zA-Z0-9_-]{0,20}$/)
  .filter((s) => s.length >= 1);

/** capability文字列の生成 */
const capabilityArb = fc.constantFrom(
  "code_generation",
  "reasoning",
  "summarization",
  "translation",
  "chat"
);

/** capabilities配列の生成（1つ以上） */
const capabilitiesArb = fc
  .uniqueArray(capabilityArb, { minLength: 1, maxLength: 5 })
  .filter((arr) => arr.length >= 1);

/** auth objectの生成 */
const authArb = fc.oneof(
  fc.constant(undefined),
  fc.record({
    api_key: fc.option(nonEmptyStringArb, { nil: undefined }),
    env_var: fc.option(nonEmptyStringArb, { nil: undefined }),
  })
);

/** scores objectの生成 */
const scoresArb = fc.oneof(
  fc.constant(undefined),
  fc
    .uniqueArray(
      fc.tuple(capabilityArb, fc.integer({ min: 0, max: 100 })),
      { minLength: 1, maxLength: 5, selector: ([k]) => k }
    )
    .map((entries) => Object.fromEntries(entries))
);

/** tags配列の生成 */
const tagsArb = fc.oneof(
  fc.constant(undefined),
  fc.array(nonEmptyStringArb, { minLength: 1, maxLength: 3 })
);

/** 有効なModelEntryの生成 */
const modelEntryArb = fc
  .record({
    id: nonEmptyStringArb,
    provider: providerArb,
    endpoint: urlArb,
    model_name: nonEmptyStringArb,
    capabilities: capabilitiesArb,
    priority: fc.integer({ min: 0, max: 1000 }),
    auth: authArb,
    timeout_ms: fc.integer({ min: 1, max: 300000 }),
    scores: scoresArb,
    tags: tagsArb,
  })
  .map((entry) => {
    // undefinedフィールドを除去してクリーンなオブジェクトにする
    const clean: Record<string, unknown> = {
      id: entry.id,
      provider: entry.provider,
      endpoint: entry.endpoint,
      model_name: entry.model_name,
      capabilities: entry.capabilities,
      priority: entry.priority,
      timeout_ms: entry.timeout_ms,
    };
    if (entry.auth !== undefined) clean.auth = entry.auth;
    if (entry.scores !== undefined) clean.scores = entry.scores;
    if (entry.tags !== undefined) clean.tags = entry.tags;
    return clean;
  });

/** 有効なConfigの生成 */
const configArb = fc
  .record({
    models: fc
      .array(modelEntryArb, { minLength: 1, maxLength: 5 })
      .map((models) => {
        // IDの一意性を保証
        const seen = new Set<string>();
        return models.filter((m) => {
          const id = m.id as string;
          if (seen.has(id)) return false;
          seen.add(id);
          return true;
        });
      })
      .filter((models) => models.length >= 1),
    defaults: fc.oneof(
      fc.constant(undefined),
      fc.record({
        timeout_ms: fc.integer({ min: 1, max: 300000 }),
      })
    ),
  })
  .map((config) => {
    const clean: Record<string, unknown> = { models: config.models };
    if (config.defaults !== undefined) clean.defaults = config.defaults;
    return clean;
  });

describe("Feature: llm-sub-agent-mcp-server, Property 11: Config_Fileラウンドトリップ", () => {
  test("有効なConfigオブジェクトはJSON.stringify→JSON.parse→スキーマバリデーションで元と等価", () => {
    fc.assert(
      fc.property(configArb, (rawConfig) => {
        // まずスキーマでパースして正規化されたConfigを得る
        const parsed = ConfigSchema.parse(rawConfig);

        // JSON.stringify → JSON.parse → スキーマバリデーション
        const serialized = JSON.stringify(parsed);
        const deserialized = JSON.parse(serialized);
        const reparsed = ConfigSchema.parse(deserialized);

        // 元のパース結果と等価であることを検証
        expect(reparsed).toEqual(parsed);
      }),
      { numRuns: 100 }
    );
  });
});
