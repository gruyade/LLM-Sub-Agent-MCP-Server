/**
 * Config Zodスキーマ定義
 * 設定ファイルのバリデーションに使用するZodスキーマ
 */
import { z } from "zod";

/** 個別モデルエントリのスキーマ */
export const ModelEntrySchema = z.object({
  id: z.string().min(1),
  provider: z.enum(["ollama", "openai", "anthropic", "gemini"]),
  endpoint: z.string().url(),
  model_name: z.string().min(1),
  capabilities: z.array(z.string()).min(1),
  priority: z.number().int().min(0).default(0),
  auth: z
    .object({
      api_key: z.string().optional(),
      env_var: z.string().optional(),
    })
    .optional(),
  timeout_ms: z.number().int().positive().default(30000),
  scores: z.record(z.string(), z.number().min(0).max(100)).optional(),
  tags: z.array(z.string()).optional(),
});

/** 設定ファイル全体のスキーマ */
export const ConfigSchema = z.object({
  models: z.array(ModelEntrySchema).min(1),
  defaults: z
    .object({
      timeout_ms: z.number().int().positive().default(30000),
    })
    .optional(),
});
