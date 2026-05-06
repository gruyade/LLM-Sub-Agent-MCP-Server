/**
 * health_check ツール実装
 * 全登録モデルに対してProvider.healthCheck()を並列実行
 * 各モデルのHealthStatus（reachable, latency_ms, error）を返却
 *
 * Validates: Requirements 4.3
 */
import type { ModelRegistry } from "@/registry/model-registry.js";
import type { ProviderAdapter } from "@/providers/base.js";
import type { HealthStatus } from "@/types/response.js";

/** MCPツールレスポンス型 */
export type ToolResponse = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

/**
 * health_check ツールハンドラ
 * 全登録モデルに対してProvider.healthCheck()を並列実行し、
 * 各モデルのHealthStatus配列をMCPツールレスポンス形式で返却
 */
export async function handleHealthCheck(
  registry: ModelRegistry,
  providers: Map<string, ProviderAdapter>,
): Promise<ToolResponse> {
  const models = registry.getAll();

  const results: HealthStatus[] = await Promise.all(
    models.map(async (model) => {
      const provider = providers.get(model.provider);
      if (!provider) {
        return {
          model_id: model.id,
          provider: model.provider,
          reachable: false,
          error: `Unknown provider: ${model.provider}`,
        };
      }
      try {
        return await provider.healthCheck(model);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          model_id: model.id,
          provider: model.provider,
          reachable: false,
          error: message,
        };
      }
    }),
  );

  return {
    content: [
      { type: "text" as const, text: JSON.stringify({ results }) },
    ],
  };
}
