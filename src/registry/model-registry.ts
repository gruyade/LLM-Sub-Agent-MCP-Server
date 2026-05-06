/**
 * Model Registry
 * バリデーション済みModelEntryを保持し、検索機能を提供
 */
import type { ModelEntry } from "@/config/types.js";

/**
 * ModelRegistryクラス
 * インメモリでModelEntryを管理し、ID検索・capability検索・デフォルト取得を提供
 */
export class ModelRegistry {
  private readonly models: ModelEntry[];

  constructor(models: ModelEntry[]) {
    this.models = [...models];
  }

  /** 全モデルエントリ取得 */
  getAll(): ModelEntry[] {
    return [...this.models];
  }

  /** ID指定で取得 */
  getById(id: string): ModelEntry | undefined {
    return this.models.find((m) => m.id === id);
  }

  /** capability指定で検索（priority降順、同一priorityはmodel_id辞書順） */
  findByCapability(capability: string): ModelEntry[] {
    return this.models
      .filter((m) => m.capabilities.includes(capability))
      .sort((a, b) => {
        if (b.priority !== a.priority) {
          return b.priority - a.priority;
        }
        return a.id.localeCompare(b.id);
      });
  }

  /** priority最高のモデル取得（同一priorityはmodel_id辞書順で先頭） */
  getDefault(): ModelEntry {
    if (this.models.length === 0) {
      throw new Error("No models registered in the registry");
    }

    return this.models.reduce((best, current) => {
      if (current.priority > best.priority) {
        return current;
      }
      if (current.priority === best.priority && current.id.localeCompare(best.id) < 0) {
        return current;
      }
      return best;
    });
  }
}

export default ModelRegistry;
