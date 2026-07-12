import { MockComputeProvider } from "./mock-provider.mjs";
import { OllamaComputeProvider } from "./ollama-provider.mjs";

export function createComputeProvider(env = process.env) {
  const provider = String(env.COMPUTE_PROVIDER || "mock").trim().toLowerCase();
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
  throw new TypeError(`Unsupported COMPUTE_PROVIDER "${provider}". Use mock or ollama.`);
}
