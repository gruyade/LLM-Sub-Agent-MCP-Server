# Requirements Document

## Introduction

KiroからMCPプロトコルを経由してローカルLLM（Ollama等）またはクラウドAPI（OpenAI, Anthropic等）をサブエージェントとして呼び出すためのMCPサーバ。複数モデルの登録・能力ベースのルーティング・軽量高速な実行環境を主要な特徴とする。

## Glossary

- **MCP_Server**: Model Context Protocolに準拠し、Kiroからのツール呼び出しを受け付けてLLMへリクエストを転送するサーバプロセス
- **Model_Registry**: 設定ファイルに定義された複数のLLMモデル情報を管理するコンポーネント
- **Model_Entry**: Model_Registryに登録される個々のモデル定義（エンドポイント、認証情報、capabilities等を含む）
- **Capability**: 各モデルが持つ能力の宣言（code_generation, reasoning, summarization, translation, chat等）
- **Router**: リクエストに含まれるcapability要求とModel_Registryの情報を照合し、最適なモデルを選択するコンポーネント
- **Provider**: LLMサービスの種別（ollama, openai, anthropic, gemini等）
- **Config_File**: MCP_Serverの設定を記述するJSONまたはYAMLファイル
- **Health_Check**: 登録モデルの到達可能性を確認する機能
- **Prompt**: LLMに送信するテキスト入力
- **Response**: LLMから返却されるテキスト出力

## Requirements

### Requirement 1: モデル登録

**User Story:** As a ユーザー, I want 複数のLLMモデルをConfig_Fileに登録する, so that 用途に応じて異なるモデルを利用できる

#### Acceptance Criteria

1. THE Model_Registry SHALL Config_Fileから1つ以上のModel_Entryを読み込む
2. WHEN Model_Entryが追加された場合, THE Model_Registry SHALL 新しいModel_Entryをサーバ再起動時に反映する
3. THE Model_Entry SHALL 以下のフィールドを含む: id（一意識別子）, provider（サービス種別）, endpoint（接続先URL）, model_name（モデル名）, capabilities（能力リスト）, auth（認証情報、任意）, tags（タグリスト、任意）
4. IF Config_Fileに重複するidのModel_Entryが存在する場合, THEN THE Model_Registry SHALL 起動時にエラーを報告し該当エントリを無視する
5. IF Config_Fileが存在しないまたはパース不能な場合, THEN THE MCP_Server SHALL エラーメッセージとともに起動を中止する

### Requirement 2: Capability宣言とルーティング

**User Story:** As a Kiro, I want 各モデルのcapabilitiesを参照して適切なモデルを選択する, so that タスクに最適なモデルへリクエストを送信できる

#### Acceptance Criteria

1. THE Model_Entry SHALL 1つ以上のCapabilityを宣言する
2. WHEN Kiroがcapability指定付きでリクエストを送信した場合, THE Router SHALL 指定されたcapabilityを持つModel_Entryの中から1つを選択する
3. WHEN 同一capabilityを持つModel_Entryが複数存在する場合, THE Router SHALL priority値が最も高いModel_Entryを選択する
4. IF 指定されたcapabilityを持つModel_Entryが存在しない場合, THEN THE Router SHALL エラーレスポンスを返却する
5. WHEN Kiroがmodel_id指定付きでリクエストを送信した場合, THE Router SHALL capabilityルーティングを迂回し指定モデルへ直接転送する
6. THE MCP_Server SHALL 登録済みモデル一覧とcapabilities情報をツールとして公開する

### Requirement 3: プロバイダ対応

**User Story:** As a ユーザー, I want ローカルLLMとクラウドAPIの両方を同一設定で利用する, so that 環境に応じて柔軟にモデルを切り替えられる

#### Acceptance Criteria

1. THE MCP_Server SHALL Ollamaプロバイダ（ローカルHTTP API）に対応する
2. THE MCP_Server SHALL OpenAI互換APIプロバイダに対応する
3. THE MCP_Server SHALL Anthropic APIプロバイダに対応する
4. THE MCP_Server SHALL Google Gemini APIプロバイダに対応する
5. WHEN Provider固有の認証が必要な場合, THE MCP_Server SHALL Model_Entryのauthフィールドまたは環境変数から認証情報を取得する
6. IF プロバイダへの接続がタイムアウトした場合, THEN THE MCP_Server SHALL 設定されたタイムアウト時間経過後にエラーレスポンスを返却する

### Requirement 4: MCPツール公開

**User Story:** As a Kiro, I want MCPプロトコル経由でLLM呼び出し機能を利用する, so that 標準的なツール呼び出しとしてサブエージェントを活用できる

#### Acceptance Criteria

1. THE MCP_Server SHALL `invoke_llm`ツールを公開する（パラメータ: prompt, capability（任意）, model_id（任意）, options（任意））
2. THE MCP_Server SHALL `list_models`ツールを公開する（登録モデル一覧とcapabilities情報を返却）
3. THE MCP_Server SHALL `health_check`ツールを公開する（各モデルの到達可能性を返却）
4. WHEN `invoke_llm`がcapabilityもmodel_idも指定なしで呼ばれた場合, THE Router SHALL デフォルトモデル（priority最高のモデル）を選択する
5. THE MCP_Server SHALL MCPプロトコルのstdioトランスポートに対応する

### Requirement 5: レスポンス処理

**User Story:** As a Kiro, I want LLMからのレスポンスを統一フォーマットで受け取る, so that プロバイダの違いを意識せずに結果を利用できる

#### Acceptance Criteria

1. THE MCP_Server SHALL 全プロバイダのレスポンスを統一フォーマット（text, model_id, provider, usage情報）に変換する
2. WHEN プロバイダがストリーミングレスポンスを返却した場合, THE MCP_Server SHALL 全チャンクを結合して完全なテキストとして返却する
3. IF プロバイダがエラーレスポンスを返却した場合, THEN THE MCP_Server SHALL エラー種別とメッセージを含む構造化エラーを返却する

### Requirement 6: 実行環境と性能

**User Story:** As a ユーザー, I want MCPサーバが軽量かつ高速に動作する, so that Kiroの応答性を損なわない

#### Acceptance Criteria

1. THE MCP_Server SHALL Bun runtime上で動作する
2. THE MCP_Server SHALL 起動から最初のリクエスト受付可能状態まで500ms以内に到達する
3. THE MCP_Server SHALL リクエストルーティング処理（LLM応答時間を除く）を10ms以内に完了する
4. THE MCP_Server SHALL アイドル時のメモリ使用量を50MB以下に維持する

### Requirement 8: ローカルLLMベンチマーク

**User Story:** As a ユーザー, I want ローカルLLMに対して事前にベンチマークを実行し結果をcapability評価として設定に反映する, so that モデルの実際の性能に基づいたルーティングが可能になる

#### Acceptance Criteria

1. THE MCP_Server SHALL `benchmark_model`ツールを公開する（パラメータ: model_id, categories（任意、デフォルトは全カテゴリ））
2. THE benchmark SHALL 各capabilityカテゴリ（code_generation, reasoning, summarization, translation, chat）に対応するテストプロンプトセットを持つ
3. WHEN benchmarkが実行された場合, THE MCP_Server SHALL 各カテゴリのスコア（0-100）と応答レイテンシを計測する
4. THE MCP_Server SHALL ベンチマーク結果をModel_Entryのscoresフィールドに保存する
5. WHEN scoresフィールドが存在する場合, THE Router SHALL priority値に加えて該当capabilityのスコアを考慮してモデルを選択する
6. THE benchmark SHALL Ollamaプロバイダ（ローカルLLM）のみを対象とする
7. IF Model_Entryにtags配列が存在し"no-benchmark"タグを含む場合, THEN THE benchmark SHALL 該当モデルをベンチマーク対象から除外する
8. IF ベンチマーク対象のモデルが到達不能な場合, THEN THE MCP_Server SHALL エラーレスポンスを返却する
9. THE MCP_Server SHALL ベンチマーク結果をConfig_Fileと同ディレクトリにbenchmark-results.jsonとして永続化する

### Requirement 7: 設定ファイルのパースと検証

**User Story:** As a ユーザー, I want 設定ファイルのフォーマットエラーを起動時に検出する, so that 実行時の予期しない動作を防止できる

#### Acceptance Criteria

1. THE Config_File SHALL JSON形式で記述する
2. WHEN Config_Fileが読み込まれた場合, THE MCP_Server SHALL スキーマバリデーションを実行する
3. IF バリデーションエラーが検出された場合, THEN THE MCP_Server SHALL エラー箇所と理由を含むメッセージを出力する
4. FOR ALL 有効なConfig_Fileオブジェクト, パースしてシリアライズしてパースした結果は元のオブジェクトと等価になる（ラウンドトリップ特性）
