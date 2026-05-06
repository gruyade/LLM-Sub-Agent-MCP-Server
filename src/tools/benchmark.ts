/**
 * benchmark_model ツール実装
 * パラメータ: model_id, categories?
 * BenchmarkRunner経由で実行、結果をModel_Entryのscoresに反映
 * "no-benchmark"タグ付きモデルはエラー返却
 *
 * Validates: Requirements 8.1, 8.4, 8.7
 */
import { z } from "zod";

import type { BenchmarkRunner } from "@/benchmark/runner.js";
import type { BenchmarkResult } from "@/benchmark/store.js";

/** benchmark_model ツールのパラメータスキーマ */
export const benchmarkModelSchema = {
  model_id: z.string().min(1).describe("ベンチマーク対象のモデルID"),
  categories: z.array(z.string()).optional().describe("対象カテゴリ（未指定時は全カテゴリ）"),
};

/** benchmark_model ツールの引数型 */
export type BenchmarkModelArgs = {
  model_id: string;
  categories?: string[];
};

/** MCPツールレスポンス型 */
export type ToolResponse = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

/**
 * benchmark_model ツールハンドラ
 * BenchmarkRunner経由でベンチマーク実行し、結果をMCPツールレスポンス形式で返却
 * モデル未発見・ベンチマーク不可の場合はErrorResponse返却
 */
export async function handleBenchmarkModel(
  args: BenchmarkModelArgs,
  runner: BenchmarkRunner,
): Promise<ToolResponse> {
  try {
    const result: BenchmarkResult = await runner.run({
      model_id: args.model_id,
      categories: args.categories,
    });

    return {
      content: [
        { type: "text" as const, text: JSON.stringify(result) },
      ],
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            error: true,
            error_type: "benchmark",
            message,
            model_id: args.model_id,
          }),
        },
      ],
      isError: true,
    };
  }
}
