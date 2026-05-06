/**
 * LLM Sub-Agent MCP Server エントリポイント
 * Config読み込み → Registry構築 → Router初期化 → ツール登録 → stdio接続
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { loadConfig } from "@/config/loader.js";
import { ModelRegistry } from "@/registry/model-registry.js";
import { CapabilityRouter } from "@/router/capability-router.js";
import type { ProviderAdapter } from "@/providers/base.js";
import { OllamaAdapter } from "@/providers/ollama.js";
import { OpenAIAdapter } from "@/providers/openai.js";
import { AnthropicAdapter } from "@/providers/anthropic.js";
import { GeminiAdapter } from "@/providers/gemini.js";
import { invokeLlmSchema, handleInvokeLlm } from "@/tools/invoke-llm.js";
import { handleListModels } from "@/tools/list-models.js";
import { handleHealthCheck } from "@/tools/health-check.js";
import { benchmarkModelSchema, handleBenchmarkModel } from "@/tools/benchmark.js";
import { BenchmarkRunner } from "@/benchmark/runner.js";
import { BenchmarkStore } from "@/benchmark/store.js";
import { dirname } from "path";

/**
 * プロバイダアダプタのマップを生成
 * provider名 → ProviderAdapterインスタンス
 */
export function createProviderMap(): Map<string, ProviderAdapter> {
  const map = new Map<string, ProviderAdapter>();
  map.set("ollama", new OllamaAdapter());
  map.set("openai", new OpenAIAdapter());
  map.set("anthropic", new AnthropicAdapter());
  map.set("gemini", new GeminiAdapter());
  return map;
}

/**
 * MCPサーバのセットアップ（テスト用にexport）
 * Config読み込み → Registry構築 → Router初期化 → ツール登録
 */
export async function setupServer(configPath: string): Promise<McpServer> {
  const config = await loadConfig(configPath);

  const registry = new ModelRegistry(config.models);
  const router = new CapabilityRouter(registry);
  const providers = createProviderMap();

  const server = new McpServer(
    { name: "llm-sub-agent", version: "0.1.0" },
  );

  // invoke_llm ツール登録
  server.tool(
    "invoke_llm",
    "LLMにプロンプトを送信し、レスポンスを取得する",
    invokeLlmSchema,
    async (args) => handleInvokeLlm(args, router, providers),
  );

  // list_models ツール登録
  server.tool(
    "list_models",
    "登録済みモデル一覧を取得する",
    {},
    async () => handleListModels(registry),
  );

  // health_check ツール登録
  server.tool(
    "health_check",
    "全登録モデルのヘルスチェックを実行する",
    {},
    async () => handleHealthCheck(registry, providers),
  );

  // benchmark_model ツール登録
  const ollamaAdapter = providers.get("ollama")!;
  const benchmarkStore = new BenchmarkStore(dirname(configPath));
  const benchmarkRunner = new BenchmarkRunner(ollamaAdapter, benchmarkStore, registry);

  server.tool(
    "benchmark_model",
    "ローカルLLMモデルのベンチマークを実行する",
    benchmarkModelSchema,
    async (args) => handleBenchmarkModel(args, benchmarkRunner),
  );

  return server;
}

/**
 * メインエントリポイント
 * コマンドライン引数からconfigパスを取得し、サーバを起動
 */
export async function main(): Promise<void> {
  const configPath = process.argv[2] ?? "./config.json";

  try {
    const server = await setupServer(configPath);
    const transport = new StdioServerTransport();
    await server.connect(transport);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[llm-sub-agent] Startup error: ${message}`);
    process.exit(1);
  }
}

// 直接実行時のみmain()を呼び出し（テスト時のimportでは実行しない）
if (import.meta.main) {
  main();
}
