/**
 * ベンチマーク スコア算出ロジック
 *
 * - evaluate(): 出力がexpected_patternにマッチするかバイナリ判定（0 or 100）
 * - calculateCategoryScore(): weight加重平均によるカテゴリスコア算出（0-100整数）
 */

export interface ScoredResult {
  score: number;
  weight: number;
}

export class Scorer {
  /**
   * 出力がexpected_patternにマッチするか判定しスコア算出
   * @param output - LLMの出力テキスト
   * @param expectedPattern - 正規表現パターン文字列
   * @returns 100（マッチ）or 0（非マッチ or 無効パターン）
   */
  evaluate(output: string, expectedPattern: string): number {
    try {
      const regex = new RegExp(expectedPattern, "i");
      return regex.test(output) ? 100 : 0;
    } catch {
      // 無効な正規表現パターンの場合は0を返す（throwしない）
      return 0;
    }
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
