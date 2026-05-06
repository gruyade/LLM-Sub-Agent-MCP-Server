/**
 * Provider基底インターフェースと共通ヘルパー
 * 全プロバイダアダプタが実装すべきインターフェースと、
 * 認証解決・タイムアウト処理の共通ロジックを提供
 */
import type { UnifiedResponse, HealthStatus } from "@/types/response.js";
import type { ModelEntry } from "@/config/types.js";

/** LLMプロバイダへのリクエスト共通型 */
export interface GenerateRequest {
  prompt: string;
  model_name: string;
  endpoint: string;
  auth?: { api_key?: string };
  options?: {
    temperature?: number;
    max_tokens?: number;
    system_prompt?: string;
  };
  timeout_ms: number;
}

/** プロバイダアダプタインターフェース */
export interface ProviderAdapter {
  readonly provider: string;
  generate(request: GenerateRequest): Promise<UnifiedResponse>;
  healthCheck(entry: ModelEntry): Promise<HealthStatus>;
}

/**
 * 認証情報解決
 * 優先順位: api_key直接指定 > env_var環境変数 > undefined
 */
export function resolveAuth(
  auth?: { api_key?: string; env_var?: string }
): string | undefined {
  if (auth?.api_key !== undefined) {
    return auth.api_key;
  }
  if (auth?.env_var !== undefined) {
    return Bun.env[auth.env_var];
  }
  return undefined;
}

/**
 * タイムアウト用AbortSignal生成
 * 指定ミリ秒後にリクエストをキャンセルするためのシグナルを返却
 */
export function createAbortSignal(timeout_ms: number): AbortSignal {
  return AbortSignal.timeout(timeout_ms);
}

/**
 * ストリーミングチャンク結合
 * 複数のテキストチャンクを順序通りに結合して完全なテキストを返却
 */
export function joinStreamChunks(chunks: string[]): string {
  return chunks.join("");
}
