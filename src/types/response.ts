/**
 * 統一レスポンス型定義
 * 全プロバイダのレスポンスを共通フォーマットに正規化するための型
 */

/** LLMプロバイダからの正規化済みレスポンス */
export interface UnifiedResponse {
  text: string;
  model_id: string;
  provider: string;
  usage: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

/** モデルのヘルスチェック結果 */
export interface HealthStatus {
  model_id: string;
  provider: string;
  reachable: boolean;
  latency_ms?: number;
  error?: string;
}

/** 構造化エラーレスポンス */
export interface ErrorResponse {
  error: true;
  error_type: "routing" | "provider" | "timeout" | "config" | "benchmark";
  message: string;
  model_id?: string;
  provider?: string;
}
