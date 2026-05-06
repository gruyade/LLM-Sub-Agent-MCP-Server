/**
 * Property 1: Config読み込みでエントリ数保存
 * Feature: llm-sub-agent-mcp-server, Property 1: Config読み込みでエントリ数保存
 *
 * 有効なConfig（重複IDなし）のmodels配列長とRegistry読み込み後のエントリ数が等しいことを検証
 *
 * **Validates: Requirements 1.1**
 */
import { describe, test, expect, spyOn } from "bun:test";
import * as fc from "fast-check";
import { ConfigSchema } from "@/config/schema.js";
import { deduplicateModels } from "@/config/loader.js";

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
  fc.constant("https://generativelanguage.googleapis.com/v1beta")
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

/** 有効なModelEntryの生成（idは外部から注入） */
const modelEntryWithIdArb = (id: string) =>
  fc
    .record({
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
      const clean: Record<string, unknown> = {
        id,
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

/**
 * 一意なIDを持つModelEntry配列の生成
 * fc.uniqueArrayでIDの一意性を保証
 */
const uniqueModelsArb = fc
  .uniqueArray(nonEmptyStringArb, { minLength: 1, maxLength: 10 })
  .filter((ids) => ids.length >= 1)
  .chain((uniqueIds) =>
    fc.tuple(...uniqueIds.map((id) => modelEntryWithIdArb(id)))
  );

describe("Feature: llm-sub-agent-mcp-server, Property 1: Config読み込みでエントリ数保存", () => {
  test("有効なConfig（重複IDなし）のmodels配列長とdeduplicateModels後のエントリ数が等しい", () => {
    fc.assert(
      fc.property(uniqueModelsArb, (rawModels) => {
        // ConfigSchemaでバリデーションし正規化されたmodelsを得る
        const config = ConfigSchema.parse({ models: rawModels });

        // deduplicateModelsを適用（重複IDなしなので全エントリ保持されるはず）
        const deduplicated = deduplicateModels(config.models);

        // 入力のmodels配列長と出力のエントリ数が等しいことを検証
        expect(deduplicated.length).toBe(config.models.length);
      }),
      { numRuns: 100 }
    );
  });
});

/**
 * Property 2: 重複ID検出・除外
 * Feature: llm-sub-agent-mcp-server, Property 2: 重複ID検出・除外
 *
 * 同一IDエントリが複数存在する場合、構築後のエントリ数が一意ID数と等しいことを検証
 * また、各一意IDについて最初の出現が保持されることを検証
 *
 * **Validates: Requirements 1.4**
 */
describe("Feature: llm-sub-agent-mcp-server, Property 2: 重複ID検出・除外", () => {
  /**
   * 重複IDを含むModelEntry配列の生成
   * - 一意なIDリストを生成し、各IDに対して複数のModelEntryを作成
   * - シャッフルして順序をランダム化
   */
  const duplicateModelsArb = fc
    .uniqueArray(nonEmptyStringArb, { minLength: 1, maxLength: 5 })
    .filter((ids) => ids.length >= 1)
    .chain((uniqueIds) =>
      // 各IDに対して2〜3個のエントリを生成
      fc
        .tuple(
          ...uniqueIds.map((id) =>
            fc
              .integer({ min: 2, max: 3 })
              .chain((count) =>
                fc.tuple(...Array.from({ length: count }, () => modelEntryWithIdArb(id)))
              )
          )
        )
        .chain((groupedEntries) => {
          // 全エントリをフラットにしてシャッフル
          const allEntries = groupedEntries.flat();
          return fc.shuffledSubarray(allEntries, {
            minLength: allEntries.length,
            maxLength: allEntries.length,
          });
        })
        .map((shuffled) => ({
          entries: shuffled,
          uniqueIds,
        }))
    );

  test("同一IDエントリが複数存在する場合、deduplicateModels後のエントリ数が一意ID数と等しい", () => {
    // console.warnを抑制（deduplicateModelsが重複検出時に警告出力するため）
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    try {
      fc.assert(
        fc.property(duplicateModelsArb, ({ entries, uniqueIds }) => {
          // ConfigSchemaでバリデーション（models配列として有効であることを確認）
          const config = ConfigSchema.parse({ models: entries });

          // deduplicateModelsを適用
          const deduplicated = deduplicateModels(config.models);

          // エントリ数が一意ID数と等しいことを検証
          expect(deduplicated.length).toBe(uniqueIds.length);

          // 各一意IDについて最初の出現が保持されることを検証
          for (const id of uniqueIds) {
            const firstInInput = config.models.find((m) => m.id === id);
            const inResult = deduplicated.find((m) => m.id === id);
            expect(inResult).toBeDefined();
            expect(inResult).toEqual(firstInInput);
          }
        }),
        { numRuns: 100 }
      );
    } finally {
      warnSpy.mockRestore();
    }
  });
});
