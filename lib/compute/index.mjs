import { MockComputeProvider } from "./mock-provider.mjs";
import { OllamaComputeProvider } from "./ollama-provider.mjs";
import { MlxComputeProvider } from "./mlx-provider.mjs";
import { MODEL_CATALOG } from "../model-catalog.mjs";
import { TogetherManagedProvider } from "./together-provider.mjs";

export function createComputeProvider(env = process.env) {
  const configured = String(env.COMPUTE_PROVIDER || "").trim().toLowerCase();
  const provider = configured || (env.TOGETHER_API_KEY ? "together" : "");
  if (!provider) {
    if (String(env.APP_MODE || "").toLowerCase() === "test") return new MockComputeProvider();
    throw new TypeError(
      "TOGETHER_API_KEY is required. Set it on the server, or use APP_MODE=test for explicit simulation."
    );
  }
  if (provider === "mock") return new MockComputeProvider();
  if (provider === "ollama") {
    return new OllamaComputeProvider({
      baseUrl: env.OLLAMA_BASE_URL || "http://127.0.0.1:11434",
      model: env.OLLAMA_MODEL,
      apiKey: env.OLLAMA_API_KEY || "",
      keepAlive: env.OLLAMA_KEEP_ALIVE || "-1m",
      startTimeoutMs: Number(env.OLLAMA_START_TIMEOUT_MS || 60_000),
      pollIntervalMs: Number(env.OLLAMA_POLL_INTERVAL_MS || 250)
    });
  }
  if (provider === "mlx") {
    return new MlxComputeProvider({
      modelPath: env.MLX_MODEL_PATH,
      modelId: "mlx-community/Qwen3-0.6B-4bit",
      modelRevision: "73e3e38d981303bc594367cd910ea6eb48349da8",
      serverCommand: env.MLX_SERVER_COMMAND,
      startTimeoutMs: Number(env.MLX_START_TIMEOUT_MS || 120_000),
      pollIntervalMs: Number(env.MLX_POLL_INTERVAL_MS || 250)
    });
  }
  if (provider === "together") {
    const model = MODEL_CATALOG[0];
    return new TogetherManagedProvider({
      apiKey: env.TOGETHER_API_KEY,
      modelId: model.providerModelId,
      artifactsRoot: env.TOGETHER_ARTIFACTS_PATH || env.OPENWEIGHT_ARTIFACTS_PATH,
      pollIntervalMs: Number(env.TOGETHER_POLL_INTERVAL_MS || 2_000),
      fileTimeoutMs: Number(env.TOGETHER_FILE_TIMEOUT_MS || 120_000),
      endpointTimeoutMs: Number(env.TOGETHER_ENDPOINT_TIMEOUT_MS || 15 * 60_000)
    });
  }
  throw new TypeError(`Unsupported COMPUTE_PROVIDER "${provider}". Use together, mock, ollama, or mlx.`);
}
