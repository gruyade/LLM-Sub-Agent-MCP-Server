import { describe, expect, test } from "bun:test";
import {
  Scorer,
  DEFAULT_CATEGORY_WEIGHTS,
  DEFAULT_LENGTH_RANGES,
  DEFAULT_SPEED_THRESHOLDS,
} from "@/benchmark/scorer";

describe("Scorer", () => {
  const scorer = new Scorer();

  describe("evaluatePatternMatch", () => {
    test("マッチする場合は100を返す", () => {
      expect(scorer.evaluatePatternMatch("Hello World", "hello")).toBe(100);
    });

    test("マッチしない場合は0を返す", () => {
      expect(scorer.evaluatePatternMatch("Hello World", "goodbye")).toBe(0);
    });

    test("case-insensitiveでマッチ判定", () => {
      expect(scorer.evaluatePatternMatch("FizzBuzz", "fizzbuzz")).toBe(100);
      expect(scorer.evaluatePatternMatch("fizzbuzz", "FIZZBUZZ")).toBe(100);
    });

    test("正規表現パターンで判定", () => {
      expect(scorer.evaluatePatternMatch("The answer is 42", "\\d+")).toBe(100);
      expect(scorer.evaluatePatternMatch("function foo() {}", "function|const|=>")).toBe(100);
    });

    test("複雑なパターンでのマッチ", () => {
      expect(
        scorer.evaluatePatternMatch(
          "interface User { id: number; name: string; email: string; }",
          "interface|type.*id.*name.*email"
        )
      ).toBe(100);
    });

    test("空文字列の出力", () => {
      expect(scorer.evaluatePatternMatch("", ".+")).toBe(0);
      expect(scorer.evaluatePatternMatch("", "")).toBe(100);
    });

    test("無効な正規表現パターンは0を返す（throwしない）", () => {
      expect(scorer.evaluatePatternMatch("test", "[invalid")).toBe(0);
      expect(scorer.evaluatePatternMatch("test", "(unclosed")).toBe(0);
      expect(scorer.evaluatePatternMatch("test", "*invalid")).toBe(0);
    });

    test("部分マッチで判定（完全一致不要）", () => {
      expect(scorer.evaluatePatternMatch("The result is 150 km", "150")).toBe(100);
    });
  });

  describe("evaluateCompleteness", () => {
    test("空文字列は0を返す", () => {
      expect(scorer.evaluateCompleteness("", "chat")).toBe(0);
    });

    test("min未満は60点以下", () => {
      // chat: min=20, "hi"は2文字 → (2/20)*60 = 6
      expect(scorer.evaluateCompleteness("hi", "chat")).toBe(6);
    });

    test("理想レンジ内は100点", () => {
      const output = "a".repeat(100); // chat: min=20, ideal_max=200
      expect(scorer.evaluateCompleteness(output, "chat")).toBe(100);
    });

    test("ideal_max超過で減点（最低30点）", () => {
      const output = "a".repeat(400); // chat: ideal_max=200, 超過率1.0 → 100-40=60
      const score = scorer.evaluateCompleteness(output, "chat");
      expect(score).toBeGreaterThanOrEqual(30);
      expect(score).toBeLessThan(100);
    });

    test("大幅超過でも30点を下回らない", () => {
      const output = "a".repeat(5000);
      expect(scorer.evaluateCompleteness(output, "reasoning")).toBeGreaterThanOrEqual(30);
    });
  });

  describe("evaluateSpeed", () => {
    test("excellent以下は100点", () => {
      // reasoning: excellent=500
      expect(scorer.evaluateSpeed(300, "reasoning")).toBe(100);
      expect(scorer.evaluateSpeed(500, "reasoning")).toBe(100);
    });

    test("poor以上は0点", () => {
      // reasoning: poor=3000
      expect(scorer.evaluateSpeed(3000, "reasoning")).toBe(0);
      expect(scorer.evaluateSpeed(10000, "reasoning")).toBe(0);
    });

    test("中間値は線形補間", () => {
      // reasoning: excellent=500, poor=3000, range=2500
      // 1750ms → (1750-500)/2500 = 0.5 → 100*(1-0.5) = 50
      expect(scorer.evaluateSpeed(1750, "reasoning")).toBe(50);
    });
  });

  describe("evaluateConciseness", () => {
    test("空文字列は0を返す", () => {
      expect(scorer.evaluateConciseness("", "chat")).toBe(0);
    });

    test("ideal_max以下は100点", () => {
      const output = "a".repeat(150); // chat: ideal_max=200
      expect(scorer.evaluateConciseness(output, "chat")).toBe(100);
    });

    test("ideal_max超過で減点", () => {
      // chat: ideal_max=200, maxAllowed=600
      // 400文字 → over=200, overRange=400, 100*(1-200/400)=50
      const output = "a".repeat(400);
      expect(scorer.evaluateConciseness(output, "chat")).toBe(50);
    });

    test("3倍以上で0点", () => {
      const output = "a".repeat(700); // chat: ideal_max=200, maxAllowed=600
      expect(scorer.evaluateConciseness(output, "chat")).toBe(0);
    });
  });

  describe("evaluate (多次元合成)", () => {
    test("全軸100点ならカテゴリ重みに関わらず100点", () => {
      // 短い正解回答、高速 (reasoning: min=10, ideal_max=100, excellent=500)
      const output = "The answer is 42";
      const score = scorer.evaluate(output, "42", "reasoning", 300);
      expect(score).toBe(100);
    });

    test("パターン不一致で大幅減点", () => {
      const output = "I don't know the answer";
      const score = scorer.evaluate(output, "42", "reasoning", 300);
      expect(score).toBeLessThan(70);
    });

    test("冗長な回答は減点される", () => {
      const longOutput = "a".repeat(2000);
      const shortOutput = "The answer is 42";
      const longScore = scorer.evaluate(longOutput, "a", "reasoning", 300);
      const shortScore = scorer.evaluate(shortOutput, "42", "reasoning", 300);
      expect(longScore).toBeLessThan(shortScore);
    });

    test("遅い回答は減点される", () => {
      const output = "The answer is 42";
      const fastScore = scorer.evaluate(output, "42", "reasoning", 300);
      const slowScore = scorer.evaluate(output, "42", "reasoning", 2800);
      expect(slowScore).toBeLessThan(fastScore);
    });

    test("categoryとlatencyのデフォルト値で動作", () => {
      const score = scorer.evaluate("Hello World", "hello");
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    });
  });

  describe("evaluateDimensions", () => {
    test("各次元のスコアを個別に返す", () => {
      // reasoning: excellent=500, poor=3000
      // 1750ms → speed=50
      const dims = scorer.evaluateDimensions("The answer is 42", "42", "reasoning", 1750);
      expect(dims.pattern_match).toBe(100);
      expect(dims.completeness).toBe(100); // 16文字, min=10
      expect(dims.speed).toBe(50); // 1750ms, excellent=500, poor=3000
      expect(dims.conciseness).toBe(100); // 16文字 < ideal_max=100
    });
  });

  describe("calculateCategoryScore", () => {
    test("空配列は0を返す", () => {
      expect(scorer.calculateCategoryScore([])).toBe(0);
    });

    test("全て100点の場合は100を返す", () => {
      const results = [
        { score: 100, weight: 1 },
        { score: 100, weight: 2 },
        { score: 100, weight: 3 },
      ];
      expect(scorer.calculateCategoryScore(results)).toBe(100);
    });

    test("全て0点の場合は0を返す", () => {
      const results = [
        { score: 0, weight: 1 },
        { score: 0, weight: 2 },
        { score: 0, weight: 3 },
      ];
      expect(scorer.calculateCategoryScore(results)).toBe(0);
    });

    test("加重平均を正しく算出", () => {
      // (100*3 + 0*2 + 100*1) / (3+2+1) = 400/6 ≈ 67
      const results = [
        { score: 100, weight: 3 },
        { score: 0, weight: 2 },
        { score: 100, weight: 1 },
      ];
      expect(scorer.calculateCategoryScore(results)).toBe(67);
    });

    test("Math.roundで整数に丸める", () => {
      // (100*1 + 0*2) / (1+2) = 100/3 ≈ 33.33 → 33
      const results = [
        { score: 100, weight: 1 },
        { score: 0, weight: 2 },
      ];
      expect(scorer.calculateCategoryScore(results)).toBe(33);
    });

    test("weight=0のみの場合は0を返す", () => {
      const results = [
        { score: 100, weight: 0 },
        { score: 50, weight: 0 },
      ];
      expect(scorer.calculateCategoryScore(results)).toBe(0);
    });

    test("単一要素の場合はそのスコアを返す", () => {
      expect(scorer.calculateCategoryScore([{ score: 75, weight: 2 }])).toBe(75);
    });
  });

  describe("カスタム設定での初期化", () => {
    test("カスタム重みで初期化可能", () => {
      const customScorer = new Scorer({
        categoryWeights: {
          custom: { pattern_match: 1.0, completeness: 0, speed: 0, conciseness: 0 },
        },
      });
      const score = customScorer.evaluate("hello", "hello", "custom", 0);
      expect(score).toBe(100);
    });

    test("カスタム速度閾値で初期化可能", () => {
      const customScorer = new Scorer({
        speedThresholds: {
          fast_category: { excellent: 100, poor: 500 },
        },
      });
      expect(customScorer.evaluateSpeed(300, "fast_category")).toBe(50);
    });
  });

  describe("実モデル出力でのスコア検証（50点付近の調整確認）", () => {
    test("code_generation: 正解だが冗長・遅い回答は50点付近", () => {
      // 実際のベンチマーク結果に近い条件: 正解、1200文字、12000ms
      const output = "function fizzBuzz(n) { " + "x".repeat(1200) + " }";
      const score = scorer.evaluate(
        output,
        "function|const|=>.*fizz.*buzz",
        "code_generation",
        12000
      );
      // 正解(35%) + 冗長減点 + 速度減点 → 40前後を期待
      expect(score).toBeGreaterThanOrEqual(30);
      expect(score).toBeLessThanOrEqual(55);
    });

    test("reasoning: 正解だが冗長な回答", () => {
      // "explanation "は12文字 × 100 = 1200文字 + 18文字 = 1218文字
      // reasoning: ideal_max=100, maxAllowed=300
      // conciseness: 1218 > 300 → 0点
      // speed: 2500ms, excellent=500, poor=3000 → (2500-500)/2500=0.8 → 20点
      // completeness: 1218 > 100, overRatio=(1218-100)/100=11.18 → 30(下限)
      // pattern_match: 100
      // 合成: 100*0.35 + 30*0.1 + 20*0.3 + 0*0.25 = 35+3+6+0 = 44
      const output = "The answer is 42. " + "explanation ".repeat(100);
      const score = scorer.evaluate(output, "42", "reasoning", 2500);
      expect(score).toBeGreaterThanOrEqual(35);
      expect(score).toBeLessThanOrEqual(55);
    });
  });
});
