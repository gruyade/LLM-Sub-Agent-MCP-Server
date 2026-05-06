# Implementation Plan: LLM Sub-Agent MCP Server

## Overview

Bun + TypeScript環境でMCPサーバを構築し、4プロバイダ（Ollama, OpenAI, Anthropic, Gemini）へのLLMリクエストをcapabilityベースでルーティングする。段階的に実装し、各ステップでテスト可能な状態を維持する。

## Tasks

- [x] 1. プロジェクト初期化と型定義
  - [x] 1.1 Bunプロジェクト初期化とパッケージインストール
    - `bun init`でプロジェクト作成
    - 依存パッケージ追加: `@modelcontextprotocol/sdk`, `zod`
    - 開発依存: `fast-check`, `@types/bun`
    - tsconfig.json設定（strict mode有効）
    - ディレクトリ構造作成（src/, tests/）
    - _Requirements: 6.1_

  - [x] 1.2 共通型定義とZodスキーマ作成
    - `src/types/response.ts`: UnifiedResponse, HealthStatus, ErrorResponse型定義
    - `src/config/types.ts`: Config, ModelEntry型定義
    - `src/config/schema.ts`: ModelEntrySchema, ConfigSchemaのZodスキーマ
    - provider enumは `["ollama", "openai", "anthropic", "gemini"]`
    - capabilitiesは `z.array(z.string()).min(1)`
    - tags, auth, scoresはoptional
    - _Requirements: 1.3, 7.1, 7.2_

  - [x] 1.3 Configスキーマのプロパティテスト
    - **Property 11: Config_Fileラウンドトリップ**
    - 有効なConfigオブジェクトをJSON.stringify→JSON.parse→スキーマバリデーションし、元と等価であることを検証
    - **Validates: Requirements 7.4**

- [x] 2. Config Loaderとバリデーション
  - [x] 2.1 Config Loader実装
    - `src/config/loader.ts`: JSONファイル読み込み・Zodバリデーション実行
    - ファイル不在時はエラーメッセージ付きで例外throw
    - パース不能時はエラーメッセージ付きで例外throw
    - バリデーションエラー時はフィールドパス情報を含むメッセージ出力
    - 重複ID検出: 最初のエントリのみ保持、警告ログ出力
    - _Requirements: 1.1, 1.4, 1.5, 7.2, 7.3_

  - [x] 2.2 Config Loaderのプロパティテスト
    - **Property 1: Config読み込みでエントリ数保存**
    - 有効なConfig（重複IDなし）のmodels配列長とRegistry読み込み後のエントリ数が等しいことを検証
    - **Validates: Requirements 1.1**

  - [x] 2.3 重複ID検出のプロパティテスト
    - **Property 2: 重複ID検出・除外**
    - 同一IDエントリが複数存在する場合、構築後のエントリ数が一意ID数と等しいことを検証
    - **Validates: Requirements 1.4**

  - [x] 2.4 バリデーションエラーのプロパティテスト
    - **Property 10: バリデーションエラーに箇所情報含む**
    - 無効なConfigオブジェクトに対し、エラーメッセージにフィールドパス情報が含まれることを検証
    - **Validates: Requirements 7.3**

- [x] 3. Model RegistryとCapability Router
  - [x] 3.1 Model Registry実装
    - `src/registry/model-registry.ts`: ModelRegistry class
    - getAll(), getById(), findByCapability(), getDefault()メソッド
    - findByCapabilityはpriority降順でソート
    - getDefaultは全モデル中priority最高を返却
    - _Requirements: 1.1, 2.1, 2.6_

  - [x] 3.2 Capability Router実装
    - `src/router/capability-router.ts`: CapabilityRouter class
    - model_id指定 → 直接転送（capability無視）
    - capability指定 → 実効priority最高のモデル選択
    - 両方なし → デフォルトモデル選択
    - 実効priority算出: scores存在時 `priority × (1 + score/100)`、なし時 `priority`
    - 同一実効priority時: model_id辞書順で決定論的選択
    - 該当モデルなし → ErrorResponse返却
    - _Requirements: 2.2, 2.3, 2.4, 2.5, 4.4, 8.5_

  - [x] 3.3 ルーティングのプロパティテスト
    - **Property 3: Capabilityルーティングは実効priority最高のモデルを選択**
    - **Property 4: 存在しないcapabilityでエラー**
    - **Property 5: model_id指定で直接転送**
    - **Property 6: デフォルトモデルはpriority最高**
    - **Property 14: スコア付きルーティングの単調性**
    - **Validates: Requirements 2.2, 2.3, 2.4, 2.5, 4.4, 8.5**

- [x] 4. Checkpoint - Config/Registry/Router動作確認
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Provider Layer実装
  - [x] 5.1 Provider基底インターフェースと認証解決
    - `src/providers/base.ts`: ProviderAdapter interface, GenerateRequest型
    - 認証解決ロジック: api_key直接指定 > env_var環境変数 > undefined
    - タイムアウト処理: AbortControllerによるリクエストキャンセル
    - _Requirements: 3.5, 3.6_

  - [x] 5.2 認証解決のプロパティテスト
    - **Property 7: 認証情報解決**
    - api_key直接指定→その値、env_var指定→環境変数値、どちらもなし→undefinedを検証
    - **Validates: Requirements 3.5**

  - [x] 5.3 Ollamaアダプタ実装
    - `src/providers/ollama.ts`: OllamaAdapter class
    - エンドポイント: `{endpoint}/api/chat`
    - 認証: なし
    - レスポンス正規化: Ollama固有フォーマット → UnifiedResponse
    - healthCheck: `/api/tags`エンドポイントへGET
    - _Requirements: 3.1, 5.1, 5.2_

  - [x] 5.4 OpenAIアダプタ実装
    - `src/providers/openai.ts`: OpenAIAdapter class
    - エンドポイント: `{endpoint}/chat/completions`
    - 認証: `Authorization: Bearer {key}`
    - レスポンス正規化: OpenAI固有フォーマット → UnifiedResponse
    - ストリーミング結合対応
    - _Requirements: 3.2, 5.1, 5.2_

  - [x] 5.5 Anthropicアダプタ実装
    - `src/providers/anthropic.ts`: AnthropicAdapter class
    - エンドポイント: `{endpoint}/v1/messages`
    - 認証: `x-api-key: {key}`
    - レスポンス正規化: Anthropic固有フォーマット → UnifiedResponse
    - _Requirements: 3.3, 5.1, 5.2_

  - [x] 5.6 Geminiアダプタ実装
    - `src/providers/gemini.ts`: GeminiAdapter class
    - エンドポイント: `{endpoint}/models/{model}:generateContent?key={key}`
    - 認証: URLパラメータ
    - レスポンス正規化: Gemini固有フォーマット → UnifiedResponse
    - _Requirements: 3.4, 5.1, 5.2_

  - [x] 5.7 レスポンス正規化のプロパティテスト
    - **Property 8: レスポンス正規化で必須フィールド保持**
    - 任意のプロバイダレスポンスに対し、正規化後にtext, model_id, provider, usageが存在することを検証
    - **Property 9: ストリーミングチャンク結合**
    - 任意のテキストチャンク配列に対し、結合結果が順序通り連結と等しいことを検証
    - **Validates: Requirements 5.1, 5.2**

- [x] 6. MCPツール実装とサーバ起動
  - [x] 6.1 MCPサーバエントリポイント作成
    - `src/index.ts`: @modelcontextprotocol/sdk使用
    - stdioトランスポート設定
    - Config読み込み → Registry構築 → Router初期化 → ツール登録
    - 起動エラー時はプロセス終了コード1で終了
    - _Requirements: 4.5, 6.1, 6.2_

  - [x] 6.2 invoke_llmツール実装
    - `src/tools/invoke-llm.ts`
    - パラメータ: prompt, capability?, model_id?, options?
    - Router経由でモデル選択 → Provider経由でLLM呼び出し → UnifiedResponse返却
    - エラー時はErrorResponse返却
    - _Requirements: 4.1, 4.4, 5.1, 5.3_

  - [x] 6.3 list_modelsツール実装
    - `src/tools/list-models.ts`
    - Registry全モデルのid, provider, model_name, capabilities, priority, scores情報を返却
    - _Requirements: 4.2, 2.6_

  - [x] 6.4 health_checkツール実装
    - `src/tools/health-check.ts`
    - 全登録モデルに対してProvider.healthCheck()を並列実行
    - 各モデルのHealthStatus（reachable, latency_ms, error）を返却
    - _Requirements: 4.3_

- [x] 7. Checkpoint - MCPサーバ基本動作確認
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. ベンチマークエンジン実装
  - [x] 8.1 テストプロンプトセット定義
    - `src/benchmark/prompts.ts`: 各カテゴリ（code_generation, reasoning, summarization, translation, chat）のテストプロンプト定義
    - 各プロンプトにexpected_pattern（正規表現）とweight設定
    - _Requirements: 8.2_

  - [x] 8.2 スコア算出ロジック実装
    - `src/benchmark/scorer.ts`: Scorer class
    - 出力とexpected_patternのマッチ判定
    - weight加重平均によるカテゴリスコア算出（0-100）
    - _Requirements: 8.3_

  - [x] 8.3 ベンチマーク結果永続化
    - `src/benchmark/store.ts`: BenchmarkStore class
    - benchmark-results.jsonへの保存・読み込み
    - Config_Fileと同ディレクトリに配置
    - _Requirements: 8.9_

  - [x] 8.4 ベンチマークランナー実装
    - `src/benchmark/runner.ts`: BenchmarkRunner class
    - isBenchmarkable(): Ollamaプロバイダかつ"no-benchmark"タグなしを判定
    - run(): カテゴリ別にテストプロンプト実行→スコア算出→結果保存
    - 到達不能モデルへのエラーハンドリング
    - _Requirements: 8.1, 8.3, 8.6, 8.7, 8.8_

  - [x] 8.5 benchmark_modelツール実装
    - `src/tools/benchmark.ts`
    - パラメータ: model_id, categories?
    - BenchmarkRunner経由で実行、結果をModel_Entryのscoresに反映
    - "no-benchmark"タグ付きモデルはエラー返却
    - _Requirements: 8.1, 8.4, 8.7_

  - [x] 8.6 ベンチマークのプロパティテスト
    - **Property 12: ベンチマークスコア範囲**
    - 各カテゴリスコアが0-100の範囲内であり、scoresキーが対象カテゴリと一致することを検証
    - **Property 13: ベンチマーク結果永続化のラウンドトリップ**
    - BenchmarkResultを保存→再読み込みし元と等価であることを検証
    - **Property 15: no-benchmarkタグによるベンチマーク除外**
    - tags含む"no-benchmark"のモデルでisBenchmarkable()がfalseを返すことを検証
    - **Validates: Requirements 8.3, 8.7, 8.9**

- [x] 9. Final checkpoint - 全テスト通過確認
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- `*`付きタスクはオプション（スキップ可能）
- 各タスクは対応するRequirementsへのトレーサビリティを保持
- チェックポイントで段階的に動作検証
- プロパティテストはfast-checkを使用し、各プロパティ最低100イテレーション
- 統合テスト（実プロバイダ接続）はCI除外対象
