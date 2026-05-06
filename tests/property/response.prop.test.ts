/**
 * レスポンス正規化のプロパティテスト
 * Feature: llm-sub-agent-mcp-server, Property 8: レスポンス正規化で必須フィールド保持
 * Feature: llm-sub-agent-mcp-server, Property 9: ストリーミングチャンク結合
 *
 * Property 8: 任意のプロバイダレスポンスに対し、正規化後にtext, model_id, provider, usageが存在する
 * Property 9: 任意のテキストチャンク配列に対し、結合結果が順序通り連結と等しい
 *
 * **Validates: Requirements 5.1, 5.2**
 */
import { describe, test, expect, afterEach } from "bun:test";
import * as fc from "fast-check";
import { OllamaAdapter } from "@/providers/ollama.js";
import { OpenAIAdapter } from "@/providers/openai.js";
import { AnthropicAdapter } from "@/providers/anthropic.js";
import { GeminiAdapter } from "@/providers/gemini.js";
import { joinStreamChunks } from "@/providers/base.js";
import type { GenerateRequest } from "@/providers/base.js";

// ─── Fetch Mock Utilities ───────────────────────────────────────────────────

const originalFetch = globalThis.fetch;

function mockFetch(
  impl: (url: string | URL | Request, init?: RequestInit) => Promise<Response>,
) {
  globalThis.fetch = impl as typeof globalThis.fetch;
}

function restoreFetch() {
  globalThis.fetch = originalFetch;
}

afterEach(() => {
  restoreFetch();
});

// ─── Arbitrary Generators ───────────────────────────────────────────────────

/** 任意のテキスト（空文字含む） */
const textArb = fc.string({ minLength: 0, maxLength: 200 });

/** 任意のモデル名（非空） */
const modelNameArb = fc.string({ minLength: 1, maxLength: 50 });

/** 任意の非負整数（トークン数） */
const tokenCountArb = fc.nat({ max: 100000 });

/** オプショナルなトークン数 */
const optionalTokenArb = fc.option(tokenCountArb, { nil: undefined });

/** Ollamaレスポンス生成 */
const ollamaResponseArb = fc.record({
  content: textArb,
  model: modelNameArb,
  eval_count: optionalTokenArb,
  prompt_eval_count: optionalTokenArb,
});

/** OpenAIレスポンス生成 */
const openaiResponseArb = fc.record({
  content: textArb,
  model: modelNameArb,
  prompt_tokens: optionalTokenArb,
  completion_tokens: optionalTokenArb,
  total_tokens: optionalTokenArb,
});

/** Anthropicレスポンス生成 */
const anthropicResponseArb = fc.record({
  text: textArb,
  model: modelNameArb,
  input_tokens: fc.nat({ max: 100000 }),
  output_tokens: fc.nat({ max: 100000 }),
});

/** Geminiレスポンス生成 */
const geminiResponseArb = fc.record({
  text: textArb,
  model: modelNameArb,
  promptTokenCount: optionalTokenArb,
  candidatesTokenCount: optionalTokenArb,
  totalTokenCount: optionalTokenArb,
});

/** ストリーミングチャンク配列 */
const chunksArb = fc.array(fc.string({ minLength: 0, maxLength: 100 }), {
  minLength: 0,
  maxLength: 50,
});

// ─── Helper ─────────────────────────────────────────────────────────────────

const baseRequest: GenerateRequest = {
  prompt: "test",
  model_name: "test-model",
  endpoint: "http://localhost:8080",
  timeout_ms: 30000,
};

// ─── Property 8: レスポンス正規化で必須フィールド保持 ────────────────────────

describe("Feature: llm-sub-agent-mcp-server, Property 8: レスポンス正規化で必須フィールド保持", () => {
  test("Ollama: 任意のレスポンスに対し正規化後にtext, model_id, provider, usageが存在", async () => {
    await fc.assert(
      fc.asyncProperty(ollamaResponseArb, async (data) => {
        const adapter = new OllamaAdapter();

        mockFetch(async () =>
          new Response(
            JSON.stringify({
              message: { role: "assistant", content: data.content },
              model: data.model,
              eval_count: data.eval_count,
              prompt_eval_count: data.prompt_eval_count,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );

        const result = await adapter.generate({
          ...baseRequest,
          model_name: data.model,
        });

        // 必須フィールドの存在と型検証
        expect(typeof result.text).toBe("string");
        expect(typeof result.model_id).toBe("string");
        expect(typeof result.provider).toBe("string");
        expect(typeof result.usage).toBe("object");
        expect(result.usage).not.toBeNull();
        expect(result.provider).toBe("ollama");
      }),
      { numRuns: 100 },
    );
  });

  test("OpenAI: 任意のレスポンスに対し正規化後にtext, model_id, provider, usageが存在", async () => {
    await fc.assert(
      fc.asyncProperty(openaiResponseArb, async (data) => {
        const adapter = new OpenAIAdapter();

        const responseBody: Record<string, unknown> = {
          choices: [{ message: { content: data.content } }],
          model: data.model,
        };

        // usage情報がある場合のみ含める
        if (
          data.prompt_tokens !== undefined ||
          data.completion_tokens !== undefined ||
          data.total_tokens !== undefined
        ) {
          responseBody.usage = {
            prompt_tokens: data.prompt_tokens,
            completion_tokens: data.completion_tokens,
            total_tokens: data.total_tokens,
          };
        }

        mockFetch(async () =>
          new Response(JSON.stringify(responseBody), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );

        const result = await adapter.generate({
          ...baseRequest,
          model_name: data.model,
        });

        // 必須フィールドの存在と型検証
        expect(typeof result.text).toBe("string");
        expect(typeof result.model_id).toBe("string");
        expect(typeof result.provider).toBe("string");
        expect(typeof result.usage).toBe("object");
        expect(result.usage).not.toBeNull();
        expect(result.provider).toBe("openai");
      }),
      { numRuns: 100 },
    );
  });

  test("Anthropic: 任意のレスポンスに対し正規化後にtext, model_id, provider, usageが存在", async () => {
    await fc.assert(
      fc.asyncProperty(anthropicResponseArb, async (data) => {
        const adapter = new AnthropicAdapter();

        mockFetch(async () =>
          new Response(
            JSON.stringify({
              content: [{ type: "text", text: data.text }],
              model: data.model,
              usage: {
                input_tokens: data.input_tokens,
                output_tokens: data.output_tokens,
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );

        const result = await adapter.generate({
          ...baseRequest,
          model_name: data.model,
        });

        // 必須フィールドの存在と型検証
        expect(typeof result.text).toBe("string");
        expect(typeof result.model_id).toBe("string");
        expect(typeof result.provider).toBe("string");
        expect(typeof result.usage).toBe("object");
        expect(result.usage).not.toBeNull();
        expect(result.provider).toBe("anthropic");
      }),
      { numRuns: 100 },
    );
  });

  test("Gemini: 任意のレスポンスに対し正規化後にtext, model_id, provider, usageが存在", async () => {
    await fc.assert(
      fc.asyncProperty(geminiResponseArb, async (data) => {
        const adapter = new GeminiAdapter();

        const responseBody: Record<string, unknown> = {
          candidates: [{ content: { parts: [{ text: data.text }] } }],
        };

        if (
          data.promptTokenCount !== undefined ||
          data.candidatesTokenCount !== undefined ||
          data.totalTokenCount !== undefined
        ) {
          responseBody.usageMetadata = {
            promptTokenCount: data.promptTokenCount,
            candidatesTokenCount: data.candidatesTokenCount,
            totalTokenCount: data.totalTokenCount,
          };
        }

        mockFetch(async () =>
          new Response(JSON.stringify(responseBody), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );

        const result = await adapter.generate({
          ...baseRequest,
          model_name: data.model,
        });

        // 必須フィールドの存在と型検証
        expect(typeof result.text).toBe("string");
        expect(typeof result.model_id).toBe("string");
        expect(typeof result.provider).toBe("string");
        expect(typeof result.usage).toBe("object");
        expect(result.usage).not.toBeNull();
        expect(result.provider).toBe("gemini");
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Property 9: ストリーミングチャンク結合 ──────────────────────────────────

describe("Feature: llm-sub-agent-mcp-server, Property 9: ストリーミングチャンク結合", () => {
  test("任意のテキストチャンク配列に対し、結合結果が順序通り連結と等しい", () => {
    fc.assert(
      fc.property(chunksArb, (chunks) => {
        const joined = joinStreamChunks(chunks);
        const concatenated = chunks.reduce((acc, c) => acc + c, "");

        expect(joined).toBe(concatenated);
      }),
      { numRuns: 100 },
    );
  });

  test("空配列の結合結果は空文字列", () => {
    fc.assert(
      fc.property(fc.constant([]), (chunks: string[]) => {
        const joined = joinStreamChunks(chunks);
        expect(joined).toBe("");
      }),
      { numRuns: 100 },
    );
  });

  test("単一チャンクの結合結果はそのチャンク自体と等しい", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 200 }),
        (chunk) => {
          const joined = joinStreamChunks([chunk]);
          expect(joined).toBe(chunk);
        },
      ),
      { numRuns: 100 },
    );
  });

  test("結合の結合性: join(a ++ b) === join(a) + join(b)", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ maxLength: 50 }), { maxLength: 25 }),
        fc.array(fc.string({ maxLength: 50 }), { maxLength: 25 }),
        (a, b) => {
          const joinedAll = joinStreamChunks([...a, ...b]);
          const joinedParts = joinStreamChunks(a) + joinStreamChunks(b);

          expect(joinedAll).toBe(joinedParts);
        },
      ),
      { numRuns: 100 },
    );
  });
});
