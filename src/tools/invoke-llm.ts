/**
 * invoke_llm ツール実装
 * パラメータ: prompt, capability?, model_id?, options?
 * Router経由でモデル選択 → Provider経由でLLM呼び出し → UnifiedResponse返却
 * エラー時はErrorResponse返却
 *
 * Validates: Requirements 4.1, 4.4, 5.1, 5.3
 */
import { z } from "zod";

import type { CapabilityRouter } from "@/router/capability-router.js";
import type { ProviderAdapter } from "@/providers/base.js";
import { resolveAuth } from "@/providers/base.js";

/** invoke_llm ツールのパラメータスキーマ */
export const invokeLlmSchema = {
  prompt: z.string().min(1).describe("LLMに送信するプロンプト"),
  capability: z.string().optional().describe("要求するcapability（ルーティングに使用）"),
  model_id: z.string().optional().describe("直接指定するモデルID"),
  options: z.object({
    temperature: z.number().min(0).max(2).optional(),
    max_tokens: z.number().int().positive().optional(),
    system_prompt: z.string().optional(),
  }).optional().describe("生成オプション"),
};

/** invoke_llm ツールの引数型 */
export type InvokeLlmArgs = {
  prompt: string;
  capability?: string;
  model_id?: string;
  options?: {
    temperature?: number;
    max_tokens?: number;
    system_prompt?: string;
  };
};

/** MCPツールレスポンス型 */
export type ToolResponse = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

/**
 * invoke_llm ツールハンドラ
 * Router経由でモデル選択 → Provider経由でLLM呼び出し → UnifiedResponse返却
 * エラー時はErrorResponse返却
 */
export async function handleInvokeLlm(
  args: InvokeLlmArgs,
  router: CapabilityRouter,
  providers: Map<string, ProviderAdapter>,
): Promise<ToolResponse> {
  // 1. Router経由でモデル選択
  const routeResult = router.route({
    capability: args.capability,
    model_id: args.model_id,
  });

  if (!routeResult.success) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            error: true,
            error_type: "routing",
            message: routeResult.error,
          }),
        },
      ],
      isError: true,
    };
  }

  // 2. Provider取得
  const model = routeResult.model;
  const provider = providers.get(model.provider);

  if (!provider) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            error: true,
            error_type: "provider",
            message: `Unknown provider: ${model.provider}`,
            model_id: model.id,
            provider: model.provider,
          }),
        },
      ],
      isError: true,
    };
  }

  // 3. Provider経由でLLM呼び出し → UnifiedResponse返却
  try {
    const resolvedKey = resolveAuth(model.auth);
    const response = await provider.generate({
      prompt: args.prompt,
      model_name: model.model_name,
      endpoint: model.endpoint,
      auth: resolvedKey ? { api_key: resolvedKey } : undefined,
      options: args.options,
      timeout_ms: model.timeout_ms,
    });

    return {
      content: [
        { type: "text" as const, text: JSON.stringify(response) },
      ],
    };
  } catch (error: unknown) {
    // 4. エラー時はErrorResponse返却（timeout判定含む）
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            error: true,
            error_type: message.includes("timed out") ? "timeout" : "provider",
            message,
            model_id: model.id,
            provider: model.provider,
          }),
        },
      ],
      isError: true,
    };
  }
}
