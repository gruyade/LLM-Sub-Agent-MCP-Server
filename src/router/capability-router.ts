/**
 * Capability Router
 * リクエストパラメータに基づきモデルを選択するルーティングロジック
 */
import type { ModelEntry } from "@/config/types.js";
import type { ModelRegistry } from "@/registry/model-registry.js";

/** ルーティングリクエスト */
export interface RouteRequest {
  capability?: string;
  model_id?: string;
}

/** ルーティング結果（成功 or エラー） */
export type RouteResult =
  | { success: true; model: ModelEntry }
  | { success: false; error: string };

/**
 * 実効priority算出
 * scores存在時: priority × (1 + score/100)
 * scores未存在時: priority
 */
export function computeEffectivePriority(
  model: ModelEntry,
  capability: string,
): number {
  const baseScore = model.priority;
  const benchmarkScore = model.scores?.[capability];
  if (benchmarkScore !== undefined) {
    return baseScore * (1 + benchmarkScore / 100);
  }
  return baseScore;
}

/**
 * CapabilityRouterクラス
 * model_id指定 → 直接転送
 * capability指定 → 実効priority最高のモデル選択
 * 両方なし → デフォルトモデル選択
 */
export class CapabilityRouter {
  private readonly registry: ModelRegistry;

  constructor(registry: ModelRegistry) {
    this.registry = registry;
  }

  /** ルーティング実行 */
  route(request: RouteRequest): RouteResult {
    // 1. model_id指定あり → 該当モデルへ直接転送
    if (request.model_id !== undefined) {
      const model = this.registry.getById(request.model_id);
      if (model === undefined) {
        return {
          success: false,
          error: `Model not found: ${request.model_id}`,
        };
      }
      return { success: true, model };
    }

    // 2. capability指定あり → 実効priority最高のモデル選択
    if (request.capability !== undefined) {
      const candidates = this.registry.findByCapability(request.capability);
      if (candidates.length === 0) {
        return {
          success: false,
          error: `No models found with capability: ${request.capability}`,
        };
      }

      const selected = this.selectByEffectivePriority(
        candidates,
        request.capability,
      );
      return { success: true, model: selected };
    }

    // 3. 両方なし → デフォルトモデル（priority最高）
    const defaultModel = this.registry.getDefault();
    return { success: true, model: defaultModel };
  }

  /**
   * 実効priority最高のモデルを選択
   * 同一実効priority時はmodel_id辞書順（昇順）で決定論的に選択
   */
  private selectByEffectivePriority(
    models: ModelEntry[],
    capability: string,
  ): ModelEntry {
    let best = models[0]!;
    let bestPriority = computeEffectivePriority(best, capability);

    for (let i = 1; i < models.length; i++) {
      const current = models[i]!;
      const currentPriority = computeEffectivePriority(current, capability);

      if (currentPriority > bestPriority) {
        best = current;
        bestPriority = currentPriority;
      } else if (
        currentPriority === bestPriority &&
        current.id.localeCompare(best.id) < 0
      ) {
        best = current;
        bestPriority = currentPriority;
      }
    }

    return best;
  }
}

export default CapabilityRouter;
