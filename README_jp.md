# LLM Sub-Agent MCP Server

[English README](README.md)

KiroからMCPプロトコル（Model Context Protocol）経由でLLM（大規模言語モデル）をサブエージェントとして呼び出すためのMCPサーバ。ローカルLLM（Ollama等）とクラウドAPI（OpenAI, Anthropic, Google Gemini）を統一インターフェースで利用可能にする。

## 概要

このMCPサーバは、Kiro IDEのエージェント機能から複数のLLMを透過的に利用するためのブリッジとして機能する。capability（能力）宣言に基づくルーティングにより、タスクの種類に応じて最適なモデルを自動選択する。

### 主な特徴

- **5プロバイダ対応**: Ollama（ローカル）、OpenAI、OpenAI互換API、Anthropic、Google Gemini
- **Capabilityベースルーティング**: `code_generation`, `reasoning`, `summarization`, `translation`, `chat` 等の能力宣言に基づきモデルを自動選択
- **スコアベースルーティング**: ベンチマーク結果を加味した実効priority算出で、実際の性能に基づく選択
- **軽量・高速**: Bun runtime上で動作、起動500ms以内、ルーティング処理10ms以内
- **統一レスポンス**: プロバイダの違いを吸収し、統一フォーマットで結果を返却

### アーキテクチャ

```
Kiro IDE ──(stdio/MCP)──> MCP Server ──(HTTP/HTTPS)──> LLM Provider
                              │
                    ┌─────────┼─────────┐
                    │         │         │
               Config    Registry   Router
               Loader                  │
                              ┌────────┼────────┐
                              │        │        │
                           Ollama   OpenAI  Anthropic ...
```

## 前提条件

- [Bun](https://bun.sh/) v1.0以上
- ローカルLLM使用時: [Ollama](https://ollama.ai/) が起動済み
- クラウドAPI使用時: 各プロバイダのAPIキー（環境変数で設定）

## インストール

```bash
git clone <repository-url>
cd llm-sub-agent-mcp-server
bun install
```

## クイックスタート

### 1. 設定ファイルの作成

`config.json.sample` をコピーして `config.json` を作成:

```bash
cp config.json.sample config.json
```

最小構成（Ollamaのみ）:

```json
{
  "models": [
    {
      "id": "local-llama",
      "provider": "ollama",
      "endpoint": "http://localhost:11434",
      "model_name": "llama3:8b",
      "capabilities": ["chat", "reasoning"],
      "priority": 10
    }
  ]
}
```

### 2. Kiroへの登録

`.kiro/settings/mcp.json` に以下を追加:

```json
{
  "mcpServers": {
    "llm-sub-agent": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/src/index.ts", "/absolute/path/to/config.json"],
      "disabled": false,
      "autoApprove": ["invoke_llm", "list_models", "health_check", "benchmark_model"]
    }
  }
}
```

> **注意**: `args` には絶対パスを使用すること。相対パスだとKiroの作業ディレクトリ次第で解決できない場合がある。

### 3. 動作確認

Kiroのチャットで以下を試す:
- `list_models` ツールでモデル一覧を確認
- `health_check` ツールで接続状態を確認
- `invoke_llm` ツールでプロンプトを送信

---

## 設定ファイル（config.json）

### 構造

```json
{
  "models": [ ... ],
  "defaults": {
    "timeout_ms": 30000
  }
}
```

### Model Entry フィールド一覧

| フィールド | 型 | 必須 | デフォルト | 説明 |
|-----------|------|------|-----------|------|
| `id` | string | ✓ | - | モデルの一意識別子 |
| `provider` | enum | ✓ | - | `"ollama"` `"openai"` `"openai-compatible"` `"anthropic"` `"gemini"` |
| `endpoint` | string (URL) | ✓ | - | プロバイダの接続先URL |
| `model_name` | string | ✓ | - | プロバイダ上のモデル名 |
| `capabilities` | string[] | ✓ | - | モデルの能力リスト（1つ以上） |
| `priority` | integer | - | `0` | ルーティング優先度（高いほど優先） |
| `auth` | object | - | - | 認証情報 |
| `auth.api_key` | string | - | - | APIキー直接指定 |
| `auth.env_var` | string | - | - | APIキーを格納する環境変数名 |
| `timeout_ms` | integer | - | `30000` | リクエストタイムアウト（ミリ秒） |
| `scores` | Record<string, number> | - | - | ベンチマーク結果スコア（0-100） |
| `tags` | string[] | - | - | タグリスト |

### Capability（推奨値）

| Capability | 用途 |
|-----------|------|
| `code_generation` | コード生成 |
| `reasoning` | 推論・論理的思考 |
| `summarization` | テキスト要約 |
| `translation` | 翻訳 |
| `chat` | 一般的な対話 |

任意の文字列を使用可能。ルーティング時に一致するモデルが選択される。

### Tags

| タグ | 効果 |
|------|------|
| `no-benchmark` | `benchmark_model` ツールの対象から除外 |

### 認証情報の解決順序

1. `auth.api_key` が指定されている場合 → その値を使用
2. `auth.env_var` が指定されている場合 → 対応する環境変数の値を使用
3. どちらもない場合 → 認証なし（Ollama等のローカルプロバイダ向け）

### defaults セクション

| フィールド | 型 | デフォルト | 説明 |
|-----------|------|-----------|------|
| `timeout_ms` | integer | `30000` | 全モデル共通のデフォルトタイムアウト |

---

## 公開ツール

### invoke_llm

LLMにプロンプトを送信し、レスポンスを取得する。

**パラメータ:**

| パラメータ | 型 | 必須 | 説明 |
|-----------|------|------|------|
| `prompt` | string | ✓ | LLMに送信するテキスト |
| `capability` | string | - | 要求するcapability（ルーティングに使用） |
| `model_id` | string | - | 直接指定するモデルID（ルーティングをバイパス） |
| `options.temperature` | number | - | 生成温度（0〜2、高いほどランダム） |
| `options.max_tokens` | number | - | 最大生成トークン数 |
| `options.system_prompt` | string | - | システムプロンプト |

**ルーティング優先順位:**

1. `model_id` 指定あり → そのモデルへ直接転送
2. `capability` 指定あり → 該当capabilityを持つモデルのうち実効priority最高を選択
3. 両方なし → 全モデル中priority最高（デフォルトモデル）を選択

**成功レスポンス:**

```json
{
  "text": "生成されたテキスト...",
  "model_id": "local-codegen",
  "provider": "ollama",
  "usage": {
    "prompt_tokens": 15,
    "completion_tokens": 120,
    "total_tokens": 135
  }
}
```

**エラーレスポンス:**

```json
{
  "error": true,
  "error_type": "routing",
  "message": "No models found with capability: unknown_capability"
}
```

### list_models

登録済みモデル一覧とcapabilities情報を取得する。パラメータなし。

**レスポンス:**

```json
{
  "models": [
    {
      "id": "local-codegen",
      "provider": "ollama",
      "model_name": "codellama:13b",
      "capabilities": ["code_generation", "reasoning"],
      "priority": 10,
      "scores": { "code_generation": 78, "reasoning": 45 }
    },
    {
      "id": "cloud-gpt4",
      "provider": "openai",
      "model_name": "gpt-4o",
      "capabilities": ["code_generation", "reasoning", "summarization"],
      "priority": 5
    }
  ]
}
```

### health_check

全登録モデルの到達可能性を並列で確認する。パラメータなし。

**レスポンス:**

```json
{
  "results": [
    {
      "model_id": "local-codegen",
      "provider": "ollama",
      "reachable": true,
      "latency_ms": 42
    },
    {
      "model_id": "cloud-gpt4",
      "provider": "openai",
      "reachable": false,
      "error": "HTTP 401: Unauthorized"
    }
  ]
}
```

### benchmark_model

ローカルLLMのベンチマークを実行し、各capabilityカテゴリのスコアを算出する。

**パラメータ:**

| パラメータ | 型 | 必須 | 説明 |
|-----------|------|------|------|
| `model_id` | string | ✓ | ベンチマーク対象のモデルID |
| `categories` | string[] | - | 対象カテゴリ（省略時は全5カテゴリ） |

**対象カテゴリ:** `code_generation`, `reasoning`, `summarization`, `translation`, `chat`

**制約:**
- `tags` に `"no-benchmark"` を含むモデルは実行不可
- モデルが到達不能な場合はエラー返却

**レスポンス:**

```json
{
  "model_id": "local-codegen",
  "timestamp": "2026-05-06T10:30:00.000Z",
  "categories": [
    {
      "category": "code_generation",
      "score": 78,
      "avg_latency_ms": 1200,
      "prompts_tested": 4,
      "details": [
        {
          "prompt": "Write a FizzBuzz function...",
          "expected_pattern": "function|const|=>.*fizz.*buzz",
          "actual_output": "function fizzBuzz(n) { ... }",
          "score": 100,
          "latency_ms": 1500
        }
      ]
    }
  ],
  "scores": {
    "code_generation": 78,
    "reasoning": 45
  }
}
```

ベンチマーク結果は `benchmark-results.json` に自動保存され、以降のルーティングに反映される。

---

## ルーティングの仕組み

### 基本ルーティング

`priority` 値が高いモデルが優先される。同一priorityの場合はmodel_idの辞書順（昇順）で決定論的に選択。

### スコアベースルーティング（実効priority）

`scores` フィールドを持つモデルは、capability指定ルーティング時に以下の式で実効priorityが算出される:

```
実効priority = priority × (1 + score / 100)
```

**計算例:**

| モデル | priority | score (code_generation) | 実効priority |
|--------|----------|------------------------|-------------|
| local-codegen | 10 | 78 | 10 × 1.78 = 17.8 |
| cloud-gpt4 | 5 | なし | 5.0 |
| local-chat | 8 | なし | 8.0 |

→ `capability: "code_generation"` 指定時、`local-codegen` が選択される

この仕組みにより、ベンチマーク結果が良いローカルモデルがクラウドAPIより優先される場合がある。クラウドAPIにはベンチマークを実行しない（`no-benchmark` タグ推奨）ため、priority値のみで比較される。

---

## プロバイダ別設定

### Ollama（ローカルLLM）

```json
{
  "id": "local-llama",
  "provider": "ollama",
  "endpoint": "http://localhost:11434",
  "model_name": "llama3:8b",
  "capabilities": ["chat", "reasoning"],
  "priority": 10
}
```

- 認証不要
- APIエンドポイント: `{endpoint}/api/chat`
- Ollamaが起動していれば即利用可能

### OpenAI

```json
{
  "id": "cloud-gpt4",
  "provider": "openai",
  "endpoint": "https://api.openai.com/v1",
  "model_name": "gpt-4o",
  "capabilities": ["code_generation", "reasoning", "summarization"],
  "priority": 5,
  "auth": { "env_var": "OPENAI_API_KEY" },
  "tags": ["no-benchmark"]
}
```

- 認証: `Authorization: Bearer {key}` ヘッダ
- APIエンドポイント: `{endpoint}/chat/completions`

### OpenAI互換API（LM Studio, vLLM等）

```json
{
  "id": "lmstudio-local",
  "provider": "openai-compatible",
  "endpoint": "http://192.168.0.32:1234/v1",
  "model_name": "my-local-model",
  "capabilities": ["chat", "code_generation"],
  "priority": 8
}
```

- OpenAI互換のChat Completions APIを提供するサーバ向け
- LM Studio, vLLM, text-generation-webui等で利用可能
- 認証はサーバ設定に依存（不要な場合が多い）

### Anthropic

```json
{
  "id": "cloud-claude",
  "provider": "anthropic",
  "endpoint": "https://api.anthropic.com",
  "model_name": "claude-sonnet-4-20250514",
  "capabilities": ["reasoning", "summarization", "translation"],
  "priority": 8,
  "auth": { "env_var": "ANTHROPIC_API_KEY" },
  "tags": ["no-benchmark"]
}
```

- 認証: `x-api-key: {key}` ヘッダ
- APIエンドポイント: `{endpoint}/v1/messages`

### Google Gemini

```json
{
  "id": "cloud-gemini",
  "provider": "gemini",
  "endpoint": "https://generativelanguage.googleapis.com/v1beta",
  "model_name": "gemini-2.5-flash",
  "capabilities": ["summarization", "translation", "chat"],
  "priority": 6,
  "auth": { "env_var": "GOOGLE_API_KEY" },
  "tags": ["no-benchmark"]
}
```

- 認証: URLパラメータ `?key={key}`
- APIエンドポイント: `{endpoint}/models/{model}:generateContent`

---

## エラーハンドリング

全エラーは構造化された `ErrorResponse` として返却される:

```json
{
  "error": true,
  "error_type": "routing | provider | timeout | config | benchmark",
  "message": "エラーの詳細メッセージ",
  "model_id": "対象モデルID（該当する場合）",
  "provider": "対象プロバイダ（該当する場合）"
}
```

| error_type | 発生状況 | 対処 |
|-----------|---------|------|
| `config` | 設定ファイルの読み込み・バリデーション失敗 | config.jsonの内容を確認 |
| `routing` | 指定capabilityを持つモデルが存在しない等 | config.jsonのcapabilities設定を確認 |
| `provider` | LLMプロバイダへのリクエスト失敗 | エンドポイントURL・認証情報を確認 |
| `timeout` | リクエストがtimeout_ms以内に完了しない | timeout_msの値を増やす、またはモデルの応答性を確認 |
| `benchmark` | ベンチマーク実行時のエラー | モデルの到達可能性・タグ設定を確認 |

---

## ベンチマーク結果ファイル（benchmark-results.json）

`benchmark_model` ツール実行時に自動生成・更新される。config.jsonと同じディレクトリに保存。

### 構造

```json
[
  {
    "model_id": "モデルID",
    "timestamp": "ISO 8601形式のタイムスタンプ",
    "categories": [
      {
        "category": "カテゴリ名",
        "score": 0-100,
        "avg_latency_ms": 平均レイテンシ,
        "prompts_tested": テスト数,
        "details": [ ... ]
      }
    ],
    "scores": {
      "category_name": 0-100
    }
  }
]
```

各カテゴリのスコアは、テストプロンプトの出力が期待パターン（正規表現）にマッチするかで判定される。スコアは0〜100の範囲で、100が全テスト合格。

---

## 開発

### テスト実行

```bash
# 全テスト
bun test

# ユニットテストのみ
bun test tests/unit/

# プロパティテスト（fast-check）のみ
bun test tests/property/

# 統合テスト（ローカルOllama必要）
bun test tests/integration/
```

### 直接起動（デバッグ用）

```bash
bun run src/index.ts ./config.json
```

stdioトランスポートで待ち受け開始。MCPクライアントからの接続を待つ。

### プロジェクト構造

```
src/
├── index.ts              # エントリポイント（MCP Server起動）
├── config/               # 設定ファイル読み込み・バリデーション
├── registry/             # Model Registry（モデル管理）
├── router/               # Capability Router（ルーティング）
├── providers/            # プロバイダアダプタ（Ollama, OpenAI等）
├── tools/                # MCPツール実装
├── benchmark/            # ベンチマークエンジン
└── types/                # 共通型定義
```

### 技術スタック

| 項目 | 選定 |
|------|------|
| Runtime | Bun |
| 言語 | TypeScript |
| MCP SDK | @modelcontextprotocol/sdk |
| バリデーション | Zod |
| トランスポート | stdio |
| テスト | bun:test + fast-check (Property-Based Testing) |

---

## トラブルシューティング

### サーバが起動しない

- `config.json` のパスが正しいか確認
- JSON構文エラーがないか確認（`bun run src/index.ts ./config.json` で直接起動してエラーメッセージを確認）
- `models` 配列が空でないか確認

### モデルに接続できない

- `health_check` ツールで到達可能性を確認
- Ollamaの場合: `ollama serve` が起動しているか確認
- クラウドAPIの場合: 環境変数にAPIキーが設定されているか確認

### ルーティングでエラーが出る

- `list_models` で登録モデルのcapabilitiesを確認
- 指定したcapabilityを持つモデルが存在するか確認
- model_id指定の場合、IDが正確に一致しているか確認

### ベンチマークが実行できない

- 対象モデルに `"no-benchmark"` タグが付いていないか確認
- 対象モデルが到達可能か `health_check` で確認

---

## ライセンス

MIT
