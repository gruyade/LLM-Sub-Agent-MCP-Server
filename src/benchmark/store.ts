/**
 * ベンチマーク結果永続化
 *
 * BenchmarkResultをbenchmark-results.jsonに保存・読み込みする。
 * Config_Fileと同ディレクトリに配置。
 */

import { join } from "path";

export interface PromptResult {
  prompt: string;
  expected_pattern: string;
  actual_output: string;
  score: number; // 0-100
  latency_ms: number;
}

export interface CategoryResult {
  category: string;
  score: number; // 0-100
  avg_latency_ms: number;
  prompts_tested: number;
  details: PromptResult[];
}

export interface BenchmarkResult {
  model_id: string;
  timestamp: string; // ISO 8601
  categories: CategoryResult[];
  scores: Record<string, number>; // capability → score (0-100)
}

const RESULTS_FILENAME = "benchmark-results.json";

export class BenchmarkStore {
  private readonly filePath: string;

  /**
   * @param directory - benchmark-results.jsonを配置するディレクトリパス
   */
  constructor(directory: string) {
    this.filePath = join(directory, RESULTS_FILENAME);
  }

  /**
   * 結果をbenchmark-results.jsonに保存
   * 既存のmodel_idがあればupsert（置換）
   */
  async save(result: BenchmarkResult): Promise<void> {
    const results = await this.readFile();
    const existingIndex = results.findIndex((r) => r.model_id === result.model_id);

    if (existingIndex >= 0) {
      results[existingIndex] = result;
    } else {
      results.push(result);
    }

    await Bun.write(this.filePath, JSON.stringify(results, null, 2));
  }

  /**
   * 保存済み結果を読み込み
   */
  async load(modelId: string): Promise<BenchmarkResult | undefined> {
    const results = await this.readFile();
    return results.find((r) => r.model_id === modelId);
  }

  /**
   * 全結果読み込み
   */
  async loadAll(): Promise<BenchmarkResult[]> {
    return this.readFile();
  }

  private async readFile(): Promise<BenchmarkResult[]> {
    const file = Bun.file(this.filePath);
    const exists = await file.exists();

    if (!exists) {
      return [];
    }

    const content = await file.text();
    return JSON.parse(content) as BenchmarkResult[];
  }
}
