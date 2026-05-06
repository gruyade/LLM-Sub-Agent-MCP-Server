import { describe, expect, test } from "bun:test";
import { Scorer } from "@/benchmark/scorer";

describe("Scorer", () => {
  const scorer = new Scorer();

  describe("evaluate", () => {
    test("マッチする場合は100を返す", () => {
      expect(scorer.evaluate("Hello World", "hello")).toBe(100);
    });

    test("マッチしない場合は0を返す", () => {
      expect(scorer.evaluate("Hello World", "goodbye")).toBe(0);
    });

    test("case-insensitiveでマッチ判定", () => {
      expect(scorer.evaluate("FizzBuzz", "fizzbuzz")).toBe(100);
      expect(scorer.evaluate("fizzbuzz", "FIZZBUZZ")).toBe(100);
    });

    test("正規表現パターンで判定", () => {
      expect(scorer.evaluate("The answer is 42", "\\d+")).toBe(100);
      expect(scorer.evaluate("function foo() {}", "function|const|=>")).toBe(100);
    });

    test("複雑なパターンでのマッチ", () => {
      expect(
        scorer.evaluate(
          "interface User { id: number; name: string; email: string; }",
          "interface|type.*id.*name.*email"
        )
      ).toBe(100);
    });

    test("空文字列の出力", () => {
      expect(scorer.evaluate("", ".+")).toBe(0);
      expect(scorer.evaluate("", "")).toBe(100); // 空パターンは全てにマッチ
    });

    test("無効な正規表現パターンは0を返す（throwしない）", () => {
      expect(scorer.evaluate("test", "[invalid")).toBe(0);
      expect(scorer.evaluate("test", "(unclosed")).toBe(0);
      expect(scorer.evaluate("test", "*invalid")).toBe(0);
    });

    test("部分マッチで判定（完全一致不要）", () => {
      expect(scorer.evaluate("The result is 150 km", "150")).toBe(100);
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
});
