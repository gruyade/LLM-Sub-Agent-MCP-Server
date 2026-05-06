# LLM Sub-Agent MCP Server

[日本語版 README はこちら](README_jp.md)

An MCP (Model Context Protocol) server that enables Kiro IDE to invoke LLMs (Large Language Models) as sub-agents. Provides a unified interface for both local LLMs (Ollama, etc.) and cloud APIs (OpenAI, Anthropic, Google Gemini).

## Overview

This MCP server acts as a bridge for Kiro IDE's agent functionality to transparently utilize multiple LLMs. Capability-based routing automatically selects the optimal model for each task type.

### Key Features

- **5 Provider Support**: Ollama (local), OpenAI, OpenAI-compatible APIs, Anthropic, Google Gemini
- **Capability-Based Routing**: Automatic model selection based on declared capabilities such as `code_generation`, `reasoning`, `summarization`, `translation`, `chat`
- **Score-Based Routing**: Effective priority calculation incorporating benchmark results for performance-based selection
- **Lightweight & Fast**: Runs on Bun runtime, startup under 500ms, routing under 10ms
- **Unified Response**: Absorbs provider differences and returns results in a consistent format

### Architecture

```
Kiro IDE ──(stdio/MCP)──> MCP Server ──(HTTP/HTTPS)──> LLM Provider
                              │
                    ┌─────────┼─────────┐
                    │         │         │
               Config    Registry   Router
               Loader                  │
                              ┌────────┼────────┐
                              │        │        │
                           Ollama   OpenAI  Anthropic ...
```

## Prerequisites

- [Bun](https://bun.sh/) v1.0 or later
- For local LLMs: [Ollama](https://ollama.ai/) running
- For cloud APIs: API keys for each provider (set via environment variables)

## Installation

```bash
git clone <repository-url>
cd llm-sub-agent-mcp-server
bun install
```

## Quick Start

### 1. Create Configuration File

Copy `config.json.sample` to `config.json`:

```bash
cp config.json.sample config.json
```

Minimal configuration (Ollama only):

```json
{
  "models": [
    {
      "id": "local-llama",
      "provider": "ollama",
      "endpoint": "http://localhost:11434",
      "model_name": "llama3:8b",
      "capabilities": ["chat", "reasoning"],
      "priority": 10
    }
  ]
}
```

### 2. Register with Kiro

Add the following to `.kiro/settings/mcp.json`:

```json
{
  "mcpServers": {
    "llm-sub-agent": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/src/index.ts", "/absolute/path/to/config.json"],
      "disabled": false,
      "autoApprove": ["invoke_llm", "list_models", "health_check", "benchmark_model"]
    }
  }
}
```

> **Note**: Use absolute paths in `args`. Relative paths may fail to resolve depending on Kiro's working directory.

### 3. Verify

Try the following in Kiro's chat:
- `list_models` tool to check registered models
- `health_check` tool to verify connectivity
- `invoke_llm` tool to send a prompt

---

## Configuration File (config.json)

### Structure

```json
{
  "models": [ ... ],
  "defaults": {
    "timeout_ms": 30000
  }
}
```

### Model Entry Fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `id` | string | ✓ | - | Unique model identifier |
| `provider` | enum | ✓ | - | `"ollama"` `"openai"` `"openai-compatible"` `"anthropic"` `"gemini"` |
| `endpoint` | string (URL) | ✓ | - | Provider connection URL |
| `model_name` | string | ✓ | - | Model name on the provider |
| `capabilities` | string[] | ✓ | - | List of capabilities (at least one) |
| `priority` | integer | - | `0` | Routing priority (higher = preferred) |
| `auth` | object | - | - | Authentication info |
| `auth.api_key` | string | - | - | Direct API key |
| `auth.env_var` | string | - | - | Environment variable name containing the API key |
| `timeout_ms` | integer | - | `30000` | Request timeout in milliseconds |
| `scores` | Record<string, number> | - | - | Benchmark scores (0-100) |
| `tags` | string[] | - | - | Tag list |

### Capabilities (Recommended Values)

| Capability | Purpose |
|-----------|---------|
| `code_generation` | Code generation |
| `reasoning` | Logical reasoning |
| `summarization` | Text summarization |
| `translation` | Translation |
| `chat` | General conversation |

Any string can be used. Models with matching capabilities are selected during routing.

### Tags

| Tag | Effect |
|-----|--------|
| `no-benchmark` | Excludes the model from `benchmark_model` tool |

### Authentication Resolution Order

1. If `auth.api_key` is specified → use that value directly
2. If `auth.env_var` is specified → use the corresponding environment variable value
3. If neither is specified → no authentication (for local providers like Ollama)

### defaults Section

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `timeout_ms` | integer | `30000` | Default timeout for all models |

---

## Exposed Tools

### invoke_llm

Send a prompt to an LLM and receive a response.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `prompt` | string | ✓ | Text to send to the LLM |
| `capability` | string | - | Required capability (used for routing) |
| `model_id` | string | - | Direct model ID (bypasses routing) |
| `options.temperature` | number | - | Generation temperature (0-2, higher = more random) |
| `options.max_tokens` | number | - | Maximum generation tokens |
| `options.system_prompt` | string | - | System prompt |

**Routing Priority:**

1. `model_id` specified → route directly to that model
2. `capability` specified → select model with highest effective priority among those with the capability
3. Neither specified → select model with highest priority (default model)

**Success Response:**

```json
{
  "text": "Generated text...",
  "model_id": "local-codegen",
  "provider": "ollama",
  "usage": {
    "prompt_tokens": 15,
    "completion_tokens": 120,
    "total_tokens": 135
  }
}
```

**Error Response:**

```json
{
  "error": true,
  "error_type": "routing",
  "message": "No models found with capability: unknown_capability"
}
```

### list_models

Retrieve the list of registered models and their capabilities. No parameters.

**Response:**

```json
{
  "models": [
    {
      "id": "local-codegen",
      "provider": "ollama",
      "model_name": "codellama:13b",
      "capabilities": ["code_generation", "reasoning"],
      "priority": 10,
      "scores": { "code_generation": 78, "reasoning": 45 }
    },
    {
      "id": "cloud-gpt4",
      "provider": "openai",
      "model_name": "gpt-4o",
      "capabilities": ["code_generation", "reasoning", "summarization"],
      "priority": 5
    }
  ]
}
```

### health_check

Check reachability of all registered models in parallel. No parameters.

**Response:**

```json
{
  "results": [
    {
      "model_id": "local-codegen",
      "provider": "ollama",
      "reachable": true,
      "latency_ms": 42
    },
    {
      "model_id": "cloud-gpt4",
      "provider": "openai",
      "reachable": false,
      "error": "HTTP 401: Unauthorized"
    }
  ]
}
```

### benchmark_model

Run benchmarks on a local LLM and calculate scores for each capability category.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `model_id` | string | ✓ | Target model ID |
| `categories` | string[] | - | Target categories (defaults to all 5 categories) |

**Target Categories:** `code_generation`, `reasoning`, `summarization`, `translation`, `chat`

**Constraints:**
- Models with `"no-benchmark"` in `tags` cannot be benchmarked
- Returns error if the model is unreachable

**Response:**

```json
{
  "model_id": "local-codegen",
  "timestamp": "2026-05-06T10:30:00.000Z",
  "categories": [
    {
      "category": "code_generation",
      "score": 78,
      "avg_latency_ms": 1200,
      "prompts_tested": 4,
      "details": [
        {
          "prompt": "Write a FizzBuzz function...",
          "expected_pattern": "function|const|=>.*fizz.*buzz",
          "actual_output": "function fizzBuzz(n) { ... }",
          "score": 100,
          "latency_ms": 1500
        }
      ]
    }
  ],
  "scores": {
    "code_generation": 78,
    "reasoning": 45
  }
}
```

Benchmark results are automatically saved to `benchmark-results.json` and reflected in subsequent routing decisions.

---

## Routing Mechanism

### Basic Routing

Models with higher `priority` values are preferred. When priorities are equal, models are selected deterministically by lexicographic order of model_id (ascending).

### Score-Based Routing (Effective Priority)

Models with a `scores` field have their effective priority calculated during capability-based routing:

```
effective_priority = priority × (1 + score / 100)
```

**Example:**

| Model | priority | score (code_generation) | effective_priority |
|-------|----------|------------------------|-------------------|
| local-codegen | 10 | 78 | 10 × 1.78 = 17.8 |
| cloud-gpt4 | 5 | none | 5.0 |
| local-chat | 8 | none | 8.0 |

→ With `capability: "code_generation"`, `local-codegen` is selected.

This mechanism allows well-performing local models to be preferred over cloud APIs. Since benchmarks are not run on cloud APIs (use the `no-benchmark` tag), they compete on priority value alone.

---

## Provider Configuration

### Ollama (Local LLM)

```json
{
  "id": "local-llama",
  "provider": "ollama",
  "endpoint": "http://localhost:11434",
  "model_name": "llama3:8b",
  "capabilities": ["chat", "reasoning"],
  "priority": 10
}
```

- No authentication required
- API endpoint: `{endpoint}/api/chat`
- Ready to use as long as Ollama is running

### OpenAI

```json
{
  "id": "cloud-gpt4",
  "provider": "openai",
  "endpoint": "https://api.openai.com/v1",
  "model_name": "gpt-4o",
  "capabilities": ["code_generation", "reasoning", "summarization"],
  "priority": 5,
  "auth": { "env_var": "OPENAI_API_KEY" },
  "tags": ["no-benchmark"]
}
```

- Authentication: `Authorization: Bearer {key}` header
- API endpoint: `{endpoint}/chat/completions`

### OpenAI-Compatible API (LM Studio, vLLM, etc.)

```json
{
  "id": "lmstudio-local",
  "provider": "openai-compatible",
  "endpoint": "http://192.168.0.32:1234/v1",
  "model_name": "my-local-model",
  "capabilities": ["chat", "code_generation"],
  "priority": 8
}
```

- For servers providing OpenAI-compatible Chat Completions API
- Works with LM Studio, vLLM, text-generation-webui, etc.
- Authentication depends on server configuration (often not required)

### Anthropic

```json
{
  "id": "cloud-claude",
  "provider": "anthropic",
  "endpoint": "https://api.anthropic.com",
  "model_name": "claude-sonnet-4-20250514",
  "capabilities": ["reasoning", "summarization", "translation"],
  "priority": 8,
  "auth": { "env_var": "ANTHROPIC_API_KEY" },
  "tags": ["no-benchmark"]
}
```

- Authentication: `x-api-key: {key}` header
- API endpoint: `{endpoint}/v1/messages`

### Google Gemini

```json
{
  "id": "cloud-gemini",
  "provider": "gemini",
  "endpoint": "https://generativelanguage.googleapis.com/v1beta",
  "model_name": "gemini-2.5-flash",
  "capabilities": ["summarization", "translation", "chat"],
  "priority": 6,
  "auth": { "env_var": "GOOGLE_API_KEY" },
  "tags": ["no-benchmark"]
}
```

- Authentication: URL parameter `?key={key}`
- API endpoint: `{endpoint}/models/{model}:generateContent`

---

## Error Handling

All errors are returned as structured `ErrorResponse` objects:

```json
{
  "error": true,
  "error_type": "routing | provider | timeout | config | benchmark",
  "message": "Detailed error message",
  "model_id": "target model ID (if applicable)",
  "provider": "target provider (if applicable)"
}
```

| error_type | Situation | Resolution |
|-----------|-----------|------------|
| `config` | Configuration file load/validation failure | Check config.json contents |
| `routing` | No model found with specified capability, etc. | Check capabilities in config.json |
| `provider` | Request to LLM provider failed | Check endpoint URL and authentication |
| `timeout` | Request did not complete within timeout_ms | Increase timeout_ms or check model responsiveness |
| `benchmark` | Error during benchmark execution | Check model reachability and tag settings |

---

## Benchmark Results File (benchmark-results.json)

Automatically generated/updated when the `benchmark_model` tool is executed. Saved in the same directory as config.json.

### Structure

```json
[
  {
    "model_id": "model ID",
    "timestamp": "ISO 8601 timestamp",
    "categories": [
      {
        "category": "category name",
        "score": 0-100,
        "avg_latency_ms": "average latency",
        "prompts_tested": "number of tests",
        "details": [ ... ]
      }
    ],
    "scores": {
      "category_name": 0-100
    }
  }
]
```

Each category score is determined by whether the test prompt output matches the expected pattern (regex). Scores range from 0 to 100, where 100 means all tests passed.

---

## Development

### Running Tests

```bash
# All tests
bun test

# Unit tests only
bun test tests/unit/

# Property tests (fast-check) only
bun test tests/property/

# Integration tests (requires local Ollama)
bun test tests/integration/
```

### Direct Execution (Debug)

```bash
bun run src/index.ts ./config.json
```

Starts listening on stdio transport, waiting for MCP client connections.

### Project Structure

```
src/
├── index.ts              # Entry point (MCP Server startup)
├── config/               # Configuration loading & validation
├── registry/             # Model Registry (model management)
├── router/               # Capability Router (routing logic)
├── providers/            # Provider adapters (Ollama, OpenAI, etc.)
├── tools/                # MCP tool implementations
├── benchmark/            # Benchmark engine
└── types/                # Shared type definitions
```

### Tech Stack

| Component | Choice |
|-----------|--------|
| Runtime | Bun |
| Language | TypeScript |
| MCP SDK | @modelcontextprotocol/sdk |
| Validation | Zod |
| Transport | stdio |
| Testing | bun:test + fast-check (Property-Based Testing) |

---

## Troubleshooting

### Server Won't Start

- Verify the `config.json` path is correct
- Check for JSON syntax errors (run `bun run src/index.ts ./config.json` directly to see error messages)
- Ensure the `models` array is not empty

### Cannot Connect to Model

- Use `health_check` tool to verify reachability
- For Ollama: confirm `ollama serve` is running
- For cloud APIs: confirm API keys are set in environment variables

### Routing Errors

- Use `list_models` to check registered model capabilities
- Verify a model with the specified capability exists
- For model_id routing, ensure the ID matches exactly

### Benchmark Won't Run

- Check if the target model has the `"no-benchmark"` tag
- Verify the target model is reachable via `health_check`

---

## License

MIT
