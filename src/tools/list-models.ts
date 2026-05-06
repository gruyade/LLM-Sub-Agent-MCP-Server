/**
 * list_models ツール実装
 * Registry全モデルのid, provider, model_name, capabilities, priority, scores情報を返却
 *
 * Validates: Requirements 4.2, 2.6
 */
import type { ModelRegistry } from "@/registry/model-registry.js";

/** MCPツールレスポンス型 */
export type ToolResponse = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

/** list_models レスポンスの個別モデル情報 */
export type ListModelEntry = {
  id: string;
  provider: string;
  model_name: string;
  capabilities: string[];
  priority: number;
  scores?: Record<string, number>;
};

/**
 * list_models ツールハンドラ
 * Registry全モデルのid, provider, model_name, capabilities, priority, scores情報を返却
 */
export function handleListModels(registry: ModelRegistry): ToolResponse {
  const models: ListModelEntry[] = registry.getAll().map((m) => ({
    id: m.id,
    provider: m.provider,
    model_name: m.model_name,
    capabilities: m.capabilities,
    priority: m.priority,
    scores: m.scores,
  }));

  return {
    content: [
      { type: "text" as const, text: JSON.stringify({ models }) },
    ],
  };
}
