/**
 * ベンチマーク スコア算出ロジック（多次元スコアリング）
 *
 * 各プロンプトに対して複数の評価軸で0-100のスコアを算出し、
 * カテゴリ別の重みで合成する。
 *
 * 評価軸:
 * - pattern_match: 期待パターンへの合致度（バイナリ 0/100）
 * - completeness: 回答の充実度（長さ・構造の適切さ）
 * - speed: 応答速度（レイテンシベースの減点）
 * - conciseness: 簡潔さ（冗長でないか）
 */

export interface ScoredResult {
  score: number;
  weight: number;
}

export interface DimensionScores {
  pattern_match: number;
  completeness: number;
  speed: number;
  conciseness: number;
}

/** カテゴリ別の各評価軸の重み */
export interface CategoryWeights {
  pattern_match: number;
  completeness: number;
  speed: number;
  conciseness: number;
}

/** カテゴリ別の期待出力長レンジ [min, ideal_max] */
export interface LengthRange {
  min: number;
  ideal_max: number;
}

/** カテゴリ別速度閾値（ms） */
export interface SpeedThresholds {
  /** この値以下なら100点 */
  excellent: number;
  /** この値以上なら0点 */
  poor: number;
}

/** デフォルトのカテゴリ別重み設定 */
export const DEFAULT_CATEGORY_WEIGHTS: Record<string, CategoryWeights> = {
  code_generation: { pattern_match: 0.35, completeness: 0.15, speed: 0.2, conciseness: 0.3 },
  reasoning: { pattern_match: 0.35, completeness: 0.1, speed: 0.3, conciseness: 0.25 },
  summarization: { pattern_match: 0.2, completeness: 0.15, speed: 0.2, conciseness: 0.45 },
  translation: { pattern_match: 0.35, completeness: 0.1, speed: 0.25, conciseness: 0.3 },
  chat: { pattern_match: 0.25, completeness: 0.2, speed: 0.2, conciseness: 0.35 },
};

/** デフォルトのカテゴリ別期待出力長レンジ */
export const DEFAULT_LENGTH_RANGES: Record<string, LengthRange> = {
  code_generation: { min: 50, ideal_max: 300 },
  reasoning: { min: 10, ideal_max: 100 },
  summarization: { min: 20, ideal_max: 150 },
  translation: { min: 3, ideal_max: 50 },
  chat: { min: 20, ideal_max: 200 },
};

/** デフォルトのカテゴリ別速度閾値（ms） */
export const DEFAULT_SPEED_THRESHOLDS: Record<string, SpeedThresholds> = {
  code_generation: { excellent: 2000, poor: 10000 },
  reasoning: { excellent: 500, poor: 3000 },
  summarization: { excellent: 300, poor: 2000 },
  translation: { excellent: 500, poor: 3000 },
  chat: { excellent: 500, poor: 5000 },
};

/** フォールバック用デフォルト値 */
const FALLBACK_WEIGHTS: CategoryWeights = {
  pattern_match: 0.4,
  completeness: 0.2,
  speed: 0.2,
  conciseness: 0.2,
};
const FALLBACK_LENGTH_RANGE: LengthRange = { min: 20, ideal_max: 300 };
const FALLBACK_SPEED_THRESHOLDS: SpeedThresholds = { excellent: 2000, poor: 10000 };

export class Scorer {
  private readonly categoryWeights: Record<string, CategoryWeights>;
  private readonly lengthRanges: Record<string, LengthRange>;
  private readonly speedThresholds: Record<string, SpeedThresholds>;

  constructor(options?: {
    categoryWeights?: Record<string, CategoryWeights>;
    lengthRanges?: Record<string, LengthRange>;
    speedThresholds?: Record<string, SpeedThresholds>;
  }) {
    this.categoryWeights = options?.categoryWeights ?? DEFAULT_CATEGORY_WEIGHTS;
    this.lengthRanges = options?.lengthRanges ?? DEFAULT_LENGTH_RANGES;
    this.speedThresholds = options?.speedThresholds ?? DEFAULT_SPEED_THRESHOLDS;
  }

  /**
   * パターンマッチ判定（バイナリ）
   * @returns 100（マッチ）or 0（非マッチ or 無効パターン）
   */
  evaluatePatternMatch(output: string, expectedPattern: string): number {
    try {
      const regex = new RegExp(expectedPattern, "i");
      return regex.test(output) ? 100 : 0;
    } catch {
      return 0;
    }
  }

  /**
   * 充実度スコア算出
   * 出力長がカテゴリの期待レンジ内なら高スコア、短すぎ/長すぎで減点
   */
  evaluateCompleteness(output: string, category: string): number {
    const len = output.trim().length;
    if (len === 0) return 0;

    const range = this.lengthRanges[category] ?? FALLBACK_LENGTH_RANGE;

    if (len < range.min) {
      // 短すぎ: min未満は比例で最大60点
      return Math.round((len / range.min) * 60);
    }
    if (len <= range.ideal_max) {
      // 理想レンジ内: 100点
      return 100;
    }
    // ideal_maxを超えた場合: 超過量に応じて減点（最低30点）
    const overRatio = (len - range.ideal_max) / range.ideal_max;
    const score = Math.round(100 - overRatio * 40);
    return Math.max(30, score);
  }

  /**
   * 速度スコア算出
   * excellent以下なら100点、poor以上なら0点、間は線形減衰
   */
  evaluateSpeed(latencyMs: number, category: string): number {
    const thresholds = this.speedThresholds[category] ?? FALLBACK_SPEED_THRESHOLDS;

    if (latencyMs <= thresholds.excellent) return 100;
    if (latencyMs >= thresholds.poor) return 0;

    // 線形補間
    const range = thresholds.poor - thresholds.excellent;
    const elapsed = latencyMs - thresholds.excellent;
    return Math.round(100 * (1 - elapsed / range));
  }

  /**
   * 簡潔さスコア算出
   * 理想レンジ内なら100点、超過するほど減点
   */
  evaluateConciseness(output: string, category: string): number {
    const len = output.trim().length;
    if (len === 0) return 0;

    const range = this.lengthRanges[category] ?? FALLBACK_LENGTH_RANGE;

    if (len <= range.ideal_max) {
      return 100;
    }

    // ideal_maxの3倍以上で0点、間は線形減衰
    const maxAllowed = range.ideal_max * 3;
    if (len >= maxAllowed) return 0;

    const overAmount = len - range.ideal_max;
    const overRange = maxAllowed - range.ideal_max;
    return Math.round(100 * (1 - overAmount / overRange));
  }

  /**
   * 多次元評価を実行し、各軸のスコアを返す
   */
  evaluateDimensions(
    output: string,
    expectedPattern: string,
    category: string,
    latencyMs: number
  ): DimensionScores {
    return {
      pattern_match: this.evaluatePatternMatch(output, expectedPattern),
      completeness: this.evaluateCompleteness(output, category),
      speed: this.evaluateSpeed(latencyMs, category),
      conciseness: this.evaluateConciseness(output, category),
    };
  }

  /**
   * 多次元スコアを合成して最終スコア算出（0-100）
   */
  evaluate(
    output: string,
    expectedPattern: string,
    category: string = "chat",
    latencyMs: number = 0
  ): number {
    const dimensions = this.evaluateDimensions(output, expectedPattern, category, latencyMs);
    const weights = this.categoryWeights[category] ?? FALLBACK_WEIGHTS;

    const composite =
      dimensions.pattern_match * weights.pattern_match +
      dimensions.completeness * weights.completeness +
      dimensions.speed * weights.speed +
      dimensions.conciseness * weights.conciseness;

    return Math.round(composite);
  }

  /**
   * weight加重平均によるカテゴリスコア算出
   * @param results - {score, weight}の配列
   * @returns 0-100の整数（Math.round適用）
   */
  calculateCategoryScore(results: ScoredResult[]): number {
    if (results.length === 0) {
      return 0;
    }

    let weightedSum = 0;
    let totalWeight = 0;

    for (const { score, weight } of results) {
      weightedSum += score * weight;
      totalWeight += weight;
    }

    if (totalWeight === 0) {
      return 0;
    }

    return Math.round(weightedSum / totalWeight);
  }
}
