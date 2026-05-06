/**
 * ベンチマーク用テストプロンプト定義
 *
 * 各カテゴリ（code_generation, reasoning, summarization, translation, chat）に
 * 3-5個のテストプロンプトを定義し、expected_pattern（正規表現）とweight設定を持つ。
 */

export interface TestPrompt {
  category: string;
  prompt: string;
  expected_pattern: string; // 正規表現で出力品質を判定（case-insensitive）
  weight: number; // スコア計算時の重み（1-3）
}

export const TEST_PROMPTS: TestPrompt[] = [
  // ─── code_generation ───────────────────────────────────────────────
  {
    category: "code_generation",
    prompt: "Write a FizzBuzz function in JavaScript that takes a number n and returns an array of strings from 1 to n.",
    expected_pattern: "function|const|=>.*fizz.*buzz",
    weight: 3,
  },
  {
    category: "code_generation",
    prompt: "Write a function that sorts an array of numbers in ascending order.",
    expected_pattern: "function|const|=>.*sort|return",
    weight: 2,
  },
  {
    category: "code_generation",
    prompt: "Define a TypeScript interface for a User with fields: id (number), name (string), and email (string).",
    expected_pattern: "interface|type.*id.*name.*email",
    weight: 2,
  },
  {
    category: "code_generation",
    prompt: "Write a function that checks if a string is a palindrome.",
    expected_pattern: "function|const|=>.*reverse|split|join|palindrome",
    weight: 1,
  },

  // ─── reasoning ─────────────────────────────────────────────────────
  {
    category: "reasoning",
    prompt: "What is 15 + 27?",
    expected_pattern: "42",
    weight: 3,
  },
  {
    category: "reasoning",
    prompt: "If all cats are animals, and Whiskers is a cat, what can we conclude about Whiskers?",
    expected_pattern: "animal",
    weight: 2,
  },
  {
    category: "reasoning",
    prompt: "What is the next number in the sequence: 2, 4, 8, 16, ?",
    expected_pattern: "32",
    weight: 2,
  },
  {
    category: "reasoning",
    prompt: "A train travels 60 km in 1 hour. How far does it travel in 2.5 hours at the same speed?",
    expected_pattern: "150",
    weight: 1,
  },

  // ─── summarization ─────────────────────────────────────────────────
  {
    category: "summarization",
    prompt:
      "Summarize in one sentence: The quick brown fox jumped over the lazy dog. The dog was sleeping in the sun and did not notice the fox. The fox continued running through the forest until it reached a river.",
    expected_pattern: ".{20,200}",
    weight: 3,
  },
  {
    category: "summarization",
    prompt:
      "Summarize the following in 2-3 sentences: Machine learning is a subset of artificial intelligence that enables systems to learn from data. It uses algorithms to identify patterns and make decisions with minimal human intervention. Applications include image recognition, natural language processing, and recommendation systems.",
    expected_pattern: ".{30,300}",
    weight: 2,
  },
  {
    category: "summarization",
    prompt:
      "Give a one-line summary: TypeScript is a programming language developed by Microsoft. It is a strict syntactical superset of JavaScript that adds optional static typing. It is designed for development of large applications and transpiles to JavaScript.",
    expected_pattern: "typescript|programming|language|javascript|typing",
    weight: 2,
  },

  // ─── translation ───────────────────────────────────────────────────
  {
    category: "translation",
    prompt: "Translate to English: こんにちは",
    expected_pattern: "hello|hi|good\\s*(afternoon|day)",
    weight: 3,
  },
  {
    category: "translation",
    prompt: "Translate to English: ありがとうございます",
    expected_pattern: "thank",
    weight: 2,
  },
  {
    category: "translation",
    prompt: "Translate to English: 今日はいい天気ですね",
    expected_pattern: "weather|nice|good|today|beautiful",
    weight: 2,
  },
  {
    category: "translation",
    prompt: "Translate to Japanese: Good morning",
    expected_pattern: "おはよう",
    weight: 1,
  },

  // ─── chat ──────────────────────────────────────────────────────────
  {
    category: "chat",
    prompt: "Introduce yourself briefly.",
    expected_pattern: ".{10,}",
    weight: 2,
  },
  {
    category: "chat",
    prompt: "What are three benefits of regular exercise?",
    expected_pattern: "health|fit|energy|sleep|stress|weight|mental|strong",
    weight: 2,
  },
  {
    category: "chat",
    prompt: "Explain what an API is in simple terms.",
    expected_pattern: "interface|connect|communicate|request|application|software",
    weight: 3,
  },
];
