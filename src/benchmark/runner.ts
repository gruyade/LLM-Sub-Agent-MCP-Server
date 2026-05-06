/**
 * ベンチマークランナー
 *
 * Ollamaプロバイダのモデルに対してカテゴリ別テストプロンプトを実行し、
 * スコアを算出して結果を永続化する。
 */

import type { ProviderAdapter, GenerateRequest } from "@/providers/base.js";
import type { ModelEntry } from "@/config/types.js";
import { TEST_PROMPTS, type TestPrompt } from "@/benchmark/prompts.js";
import { Scorer } from "@/benchmark/scorer.js";
import {
  BenchmarkStore,
  type BenchmarkResult,
  type CategoryResult,
  type PromptResult,
} from "@/benchmark/store.js";
import type { ModelRegistry } from "@/registry/model-registry.js";

export interface BenchmarkRequest {
  model_id: string;
  categories?: string[]; // 未指定時は全カテゴリ
}

export class BenchmarkRunner {
  private readonly provider: ProviderAdapter;
  private readonly store: BenchmarkStore;
  private readonly registry: ModelRegistry;
  private readonly scorer: Scorer;

  constructor(provider: ProviderAdapter, store: BenchmarkStore, registry: ModelRegistry) {
    this.provider = provider;
    this.store = store;
    this.registry = registry;
    this.scorer = new Scorer();
  }

  /**
   * モデルがベンチマーク対象か判定
   * Ollamaプロバイダかつ"no-benchmark"タグなしの場合true
   */
  isBenchmarkable(entry: ModelEntry): boolean {
    if (entry.provider !== "ollama") {
      return false;
    }
    if (entry.tags?.includes("no-benchmark")) {
      return false;
    }
    return true;
  }

  /**
   * ベンチマーク実行
   * カテゴリ別にテストプロンプトを実行し、スコアを算出して結果を保存
   */
  async run(request: BenchmarkRequest): Promise<BenchmarkResult> {
    const entry = this.registry.getById(request.model_id);
    if (!entry) {
      throw new Error(`Model not found: ${request.model_id}`);
    }

    if (!this.isBenchmarkable(entry)) {
      throw new Error(
        `Model "${request.model_id}" is not benchmarkable: ` +
          `provider must be "ollama" and must not have "no-benchmark" tag`
      );
    }

    // カテゴリでフィルタ（未指定時は全カテゴリ）
    const prompts = this.filterPrompts(request.categories);

    // カテゴリ別にグループ化
    const groupedPrompts = this.groupByCategory(prompts);

    // 各カテゴリのプロンプトを実行してスコア算出
    const categories: CategoryResult[] = [];
    const scores: Record<string, number> = {};

    for (const [category, categoryPrompts] of Object.entries(groupedPrompts)) {
      const categoryResult = await this.runCategory(entry, category, categoryPrompts);
      categories.push(categoryResult);
      scores[category] = categoryResult.score;
    }

    const result: BenchmarkResult = {
      model_id: request.model_id,
      timestamp: new Date().toISOString(),
      categories,
      scores,
    };

    await this.store.save(result);
    return result;
  }

  private filterPrompts(categories?: string[]): TestPrompt[] {
    if (!categories || categories.length === 0) {
      return TEST_PROMPTS;
    }
    return TEST_PROMPTS.filter((p) => categories.includes(p.category));
  }

  private groupByCategory(prompts: TestPrompt[]): Record<string, TestPrompt[]> {
    const grouped: Record<string, TestPrompt[]> = {};
    for (const prompt of prompts) {
      if (!grouped[prompt.category]) {
        grouped[prompt.category] = [];
      }
      grouped[prompt.category]!.push(prompt);
    }
    return grouped;
  }

  private async runCategory(
    entry: ModelEntry,
    category: string,
    prompts: TestPrompt[]
  ): Promise<CategoryResult> {
    const details: PromptResult[] = [];

    for (const testPrompt of prompts) {
      const promptResult = await this.runSinglePrompt(entry, testPrompt);
      details.push(promptResult);
    }

    // weight加重平均でカテゴリスコア算出
    const scoredResults = details.map((d, i) => ({
      score: d.score,
      weight: prompts[i]!.weight,
    }));
    const categoryScore = this.scorer.calculateCategoryScore(scoredResults);

    // 平均レイテンシ算出
    const totalLatency = details.reduce((sum, d) => sum + d.latency_ms, 0);
    const avgLatency = details.length > 0 ? Math.round(totalLatency / details.length) : 0;

    return {
      category,
      score: categoryScore,
      avg_latency_ms: avgLatency,
      prompts_tested: details.length,
      details,
    };
  }

  private async runSinglePrompt(entry: ModelEntry, testPrompt: TestPrompt): Promise<PromptResult> {
    const request: GenerateRequest = {
      prompt: testPrompt.prompt,
      model_name: entry.model_name,
      endpoint: entry.endpoint,
      auth: entry.auth ? { api_key: entry.auth.api_key } : undefined,
      timeout_ms: entry.timeout_ms,
    };

    const startTime = performance.now();

    try {
      const response = await this.provider.generate(request);
      const latency = Math.round(performance.now() - startTime);
      const score = this.scorer.evaluate(response.text, testPrompt.expected_pattern);

      return {
        prompt: testPrompt.prompt,
        expected_pattern: testPrompt.expected_pattern,
        actual_output: response.text,
        score,
        latency_ms: latency,
      };
    } catch {
      // 到達不能モデルへのエラーハンドリング: score=0で記録
      const latency = Math.round(performance.now() - startTime);
      return {
        prompt: testPrompt.prompt,
        expected_pattern: testPrompt.expected_pattern,
        actual_output: "",
        score: 0,
        latency_ms: latency,
      };
    }
  }
}
