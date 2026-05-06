/**
 * Config型定義
 * Zodスキーマから推論されたTypeScript型
 */
import type { z } from "zod";
import type { ModelEntrySchema, ConfigSchema } from "./schema.js";

/** 個別モデルエントリの型 */
export type ModelEntry = z.infer<typeof ModelEntrySchema>;

/** 設定ファイル全体の型 */
export type Config = z.infer<typeof ConfigSchema>;
