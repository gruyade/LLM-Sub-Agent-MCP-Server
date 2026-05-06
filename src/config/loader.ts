/**
 * Config Loader
 * JSONファイル読み込み・Zodバリデーション・重複ID検出
 */
import { ConfigSchema } from "@/config/schema.js";
import type { Config, ModelEntry } from "@/config/types.js";
import { ZodError } from "zod";

/**
 * 重複IDを検出し、最初のエントリのみ保持する。
 * 重複があった場合はconsole.warnで警告出力。
 */
export function deduplicateModels(models: ModelEntry[]): ModelEntry[] {
  const seen = new Set<string>();
  const result: ModelEntry[] = [];

  for (const model of models) {
    if (seen.has(model.id)) {
      console.warn(
        `[config] Duplicate model ID "${model.id}" detected. Keeping first entry, ignoring duplicate.`
      );
      continue;
    }
    seen.add(model.id);
    result.push(model);
  }

  return result;
}

/**
 * 指定パスからConfig JSONファイルを読み込み、バリデーション・重複ID除去を行う。
 *
 * @throws ファイル不在、パース不能、バリデーションエラー時にErrorをthrow
 */
export async function loadConfig(path: string): Promise<Config> {
  // 1. ファイル読み込み
  const file = Bun.file(path);
  const exists = await file.exists();
  if (!exists) {
    throw new Error(`Config file not found: ${path}`);
  }

  // 2. JSONパース
  let rawData: unknown;
  try {
    const text = await file.text();
    rawData = JSON.parse(text);
  } catch (e) {
    throw new Error(
      `Failed to parse config file: ${path}` +
        (e instanceof Error ? ` (${e.message})` : "")
    );
  }

  // 3. Zodバリデーション
  let config: Config;
  try {
    config = ConfigSchema.parse(rawData);
  } catch (e) {
    if (e instanceof ZodError) {
      const details = e.issues
        .map((issue) => {
          const fieldPath = issue.path.length > 0 ? issue.path.join(".") : "(root)";
          return `  - ${fieldPath}: ${issue.message}`;
        })
        .join("\n");
      throw new Error(
        `Config validation failed for: ${path}\n${details}`
      );
    }
    throw e;
  }

  // 4. 重複ID検出・除去
  config = {
    ...config,
    models: deduplicateModels(config.models),
  };

  return config;
}
