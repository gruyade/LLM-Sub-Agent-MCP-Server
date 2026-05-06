/**
 * Property 10: バリデーションエラーに箇所情報含む
 * Feature: llm-sub-agent-mcp-server, Property 10: バリデーションエラーに箇所情報含む
 *
 * 無効なConfigオブジェクトに対し、ZodErrorのissuesにフィールドパス情報が含まれることを検証
 *
 * **Validates: Requirements 7.3**
 */
import { describe, test, expect } from "bun:test";
import * as fc from "fast-check";
import { ZodError } from "zod";
import { ConfigSchema } from "@/config/schema.js";

/**
 * 有効なConfigベースを生成し、特定フィールドを無効値で上書きする戦略。
 * 各生成値は少なくとも1つのフィールドがスキーマ違反となる。
 */

/** 有効なprovider値 */
const validProviders = ["ollama", "openai", "anthropic", "gemini"] as const;

/** 有効なURL */
const validUrl = "http://localhost:11434";

/** 有効なベースモデルエントリ */
const validModelEntry = {
  id: "test-model",
  provider: "ollama",
  endpoint: validUrl,
  model_name: "codellama:13b",
  capabilities: ["code_generation"],
  priority: 10,
  timeout_ms: 30000,
};

/** 無効化の種類 */
type InvalidationType =
  | "empty_id"
  | "invalid_provider"
  | "invalid_endpoint"
  | "empty_capabilities"
  | "negative_priority"
  | "score_too_high"
  | "score_too_low"
  | "invalid_timeout";

/** 無効化種類のArbitrary */
const invalidationTypeArb: fc.Arbitrary<InvalidationType> = fc.constantFrom(
  "empty_id",
  "invalid_provider",
  "invalid_endpoint",
  "empty_capabilities",
  "negative_priority",
  "score_too_high",
  "score_too_low",
  "invalid_timeout"
);

/**
 * 無効化種類に応じてモデルエントリを破壊し、
 * 期待されるパスプレフィックスを返す
 */
function corruptModelEntry(
  invalidationType: InvalidationType
): { entry: Record<string, unknown>; expectedPathPrefix: string } {
  const entry = { ...validModelEntry } as Record<string, unknown>;

  switch (invalidationType) {
    case "empty_id":
      entry.id = "";
      return { entry, expectedPathPrefix: "models" };
    case "invalid_provider":
      entry.provider = "invalid_provider_xyz";
      return { entry, expectedPathPrefix: "models" };
    case "invalid_endpoint":
      entry.endpoint = "not-a-url";
      return { entry, expectedPathPrefix: "models" };
    case "empty_capabilities":
      entry.capabilities = [];
      return { entry, expectedPathPrefix: "models" };
    case "negative_priority":
      entry.priority = -5;
      return { entry, expectedPathPrefix: "models" };
    case "score_too_high":
      entry.scores = { code_generation: 150 };
      return { entry, expectedPathPrefix: "models" };
    case "score_too_low":
      entry.scores = { code_generation: -10 };
      return { entry, expectedPathPrefix: "models" };
    case "invalid_timeout":
      entry.timeout_ms = -1;
      return { entry, expectedPathPrefix: "models" };
  }
}

/** 無効なConfigオブジェクトのArbitrary */
const invalidConfigArb = invalidationTypeArb.map((invalidationType) => {
  const { entry, expectedPathPrefix } = corruptModelEntry(invalidationType);
  return {
    config: { models: [entry] },
    invalidationType,
    expectedPathPrefix,
  };
});

/**
 * 複数モデルのうち特定インデックスのモデルを無効化するArbitrary。
 * パスに配列インデックスが含まれることを検証するため。
 * empty_idはIDを空にする必要があるため、ID上書きと競合しないよう除外。
 */
const invalidationTypeNoIdArb: fc.Arbitrary<InvalidationType> = fc.constantFrom(
  "invalid_provider",
  "invalid_endpoint",
  "empty_capabilities",
  "negative_priority",
  "score_too_high",
  "score_too_low",
  "invalid_timeout"
);

const invalidConfigWithIndexArb = fc
  .tuple(
    fc.integer({ min: 0, max: 2 }), // 無効化するモデルのインデックス
    invalidationTypeNoIdArb
  )
  .map(([targetIndex, invalidationType]) => {
    // 3つの有効なモデルエントリを作成
    const models = Array.from({ length: 3 }, (_, i) => ({
      ...validModelEntry,
      id: `model-${i}`,
    })) as Record<string, unknown>[];

    // targetIndexのモデルを無効化（IDは一意性を保持）
    const { entry } = corruptModelEntry(invalidationType);
    entry.id = `model-${targetIndex}`;
    models[targetIndex] = entry;

    return {
      config: { models },
      targetIndex,
      invalidationType,
    };
  });

describe("Feature: llm-sub-agent-mcp-server, Property 10: バリデーションエラーに箇所情報含む", () => {
  test("無効なConfigオブジェクトのZodErrorはpath情報を含むissuesを持つ", () => {
    fc.assert(
      fc.property(invalidConfigArb, ({ config, invalidationType }) => {
        let caughtError: ZodError | null = null;

        try {
          ConfigSchema.parse(config);
        } catch (e) {
          if (e instanceof ZodError) {
            caughtError = e;
          } else {
            throw e;
          }
        }

        // バリデーションエラーが発生すること
        expect(caughtError).not.toBeNull();

        // 全issuesがpath情報（path.length > 0）を持つこと
        for (const issue of caughtError!.issues) {
          expect(issue.path.length).toBeGreaterThan(0);
        }

        // pathの先頭要素が"models"であること（モデル配列内のエラー）
        const hasModelsPath = caughtError!.issues.some(
          (issue) => issue.path[0] === "models"
        );
        expect(hasModelsPath).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  test("複数モデル中の特定インデックスのエラーはpath内にインデックス情報を含む", () => {
    fc.assert(
      fc.property(
        invalidConfigWithIndexArb,
        ({ config, targetIndex, invalidationType }) => {
          let caughtError: ZodError | null = null;

          try {
            ConfigSchema.parse(config);
          } catch (e) {
            if (e instanceof ZodError) {
              caughtError = e;
            } else {
              throw e;
            }
          }

          // バリデーションエラーが発生すること
          expect(caughtError).not.toBeNull();

          // issuesのpathにターゲットインデックスが含まれること
          const hasTargetIndex = caughtError!.issues.some(
            (issue) =>
              issue.path[0] === "models" && issue.path[1] === targetIndex
          );
          expect(hasTargetIndex).toBe(true);

          // path長が3以上（"models" → index → field）であること
          const hasFullPath = caughtError!.issues.some(
            (issue) => issue.path.length >= 3
          );
          expect(hasFullPath).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });
});
