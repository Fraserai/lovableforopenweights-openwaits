import { randomUUID } from "node:crypto";

const DEFAULT_BASE_URL = "http://127.0.0.1:11434";

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class OllamaProviderError extends Error {
  constructor(message, { status = 503, cause } = {}) {
    super(message, { cause });
    this.name = "OllamaProviderError";
    this.status = status;
  }
}

export class OllamaComputeProvider {
  name = "ollama";
  displayName = "Ollama";
  executionMode = "real";
  realExecution = true;
  supportsAdaptedState = false;
  hardware = "Local Ollama runtime";

  constructor({
    baseUrl = DEFAULT_BASE_URL,
    model,
    apiKey = "",
    keepAlive = "-1m",
    startTimeoutMs = 60_000,
    pollIntervalMs = 250,
    fetchImpl = globalThis.fetch
  } = {}) {
    if (!String(model || "").trim()) {
      throw new TypeError("OLLAMA_MODEL is required when COMPUTE_PROVIDER=ollama");
    }
    if (typeof fetchImpl !== "function") {
      throw new TypeError("OllamaComputeProvider requires a fetch implementation");
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(baseUrl);
    } catch {
      throw new TypeError("OLLAMA_BASE_URL must be a valid HTTP or HTTPS URL");
    }
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      throw new TypeError("OLLAMA_BASE_URL must use HTTP or HTTPS");
    }
    if (parsedUrl.username || parsedUrl.password) {
      throw new TypeError("Keep credentials out of OLLAMA_BASE_URL; use OLLAMA_API_KEY");
    }
    if (!Number.isFinite(startTimeoutMs) || startTimeoutMs <= 0) {
      throw new TypeError("OLLAMA_START_TIMEOUT_MS must be a positive number");
    }
    if (!Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0) {
      throw new TypeError("Ollama poll interval must be a positive number");
    }

    this.baseUrl = parsedUrl.toString().replace(/\/$/, "").replace(/\/api$/, "");
    this.hardware = ["127.0.0.1", "localhost", "[::1]"].includes(parsedUrl.hostname)
      ? "Local Ollama runtime"
      : "Remote Ollama endpoint";
    this.actualModelId = String(model).trim();
    this.apiKey = apiKey;
    this.keepAlive = keepAlive;
    this.startTimeoutMs = startTimeoutMs;
    this.pollIntervalMs = pollIntervalMs;
    this.fetchImpl = fetchImpl;
  }

  async request(pathname, options = {}) {
    const headers = {
      "content-type": "application/json",
      ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
      ...(options.headers || {})
    };

    let response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${pathname}`, {
        ...options,
        headers,
        signal: options.signal || AbortSignal.timeout(this.startTimeoutMs)
      });
    } catch (error) {
      throw new OllamaProviderError(
        `Ollama backend is unavailable at ${this.baseUrl}: ${error.message}`,
        { cause: error }
      );
    }

    const raw = await response.text();
    let payload = {};
    if (raw) {
      try {
        payload = JSON.parse(raw);
      } catch {
        throw new OllamaProviderError(`Ollama returned invalid JSON from ${pathname}`);
      }
    }

    if (!response.ok) {
      throw new OllamaProviderError(
        payload.error || `Ollama request to ${pathname} failed with HTTP ${response.status}`,
        { status: response.status >= 500 ? 503 : response.status }
      );
    }
    return payload;
  }

  async start({ workspace, modelState, runId }) {
    if (modelState !== "base") {
      throw new OllamaProviderError(
        "The Ollama development provider can run only the base state; adaptation training has not been implemented",
        { status: 409 }
      );
    }

    const version = await this.request("/api/version");
    let modelInfo;
    try {
      modelInfo = await this.request("/api/show", {
        method: "POST",
        body: JSON.stringify({ model: this.actualModelId })
      });
    } catch (error) {
      if (error.status === 404) {
        throw new OllamaProviderError(
          `Ollama model "${this.actualModelId}" is not installed. Run: ollama pull ${this.actualModelId}`
        );
      }
      throw error;
    }

    const loaded = await this.request("/api/generate", {
      method: "POST",
      body: JSON.stringify({
        model: this.actualModelId,
        prompt: "",
        stream: false,
        keep_alive: this.keepAlive
      })
    });

    const deadline = Date.now() + this.startTimeoutMs;
    let health;
    do {
      health = await this.getStatus();
      if (health.status === "running") break;
      if (Date.now() >= deadline) {
        throw new OllamaProviderError(
          `Ollama did not report model "${this.actualModelId}" as healthy within ${this.startTimeoutMs}ms`
        );
      }
      await wait(this.pollIntervalMs);
    } while (true);

    const actualModelId = loaded.model || health.actualModelId || this.actualModelId;
    return {
      id: runId || randomUUID(),
      provider: this.name,
      providerDisplayName: this.displayName,
      executionMode: this.executionMode,
      realExecution: true,
      status: "running",
      requestedModelId: workspace.baseModel.id,
      actualModelId,
      developmentModel: actualModelId !== workspace.baseModel.id,
      modelState: {
        kind: "base",
        label: `${actualModelId} development model`,
        adaptationId: null
      },
      endpoint: `/api/workspaces/${workspace.id}/chat`,
      backendEndpoint: this.baseUrl,
      hardware: this.hardware,
      modelDigest: health.modelDigest || null,
      modelDetails: modelInfo.details || null,
      ollamaVersion: version.version || "unknown",
      startingAt: workspace.run?.startingAt || new Date().toISOString(),
      startedAt: new Date().toISOString(),
      checkedAt: health.checkedAt,
      note: `Real inference through Ollama using ${actualModelId}; this is not GLM-5.2.`
    };
  }

  async getStatus() {
    const payload = await this.request("/api/ps");
    const runningModel = (payload.models || []).find((entry) =>
      entry.name === this.actualModelId || entry.model === this.actualModelId
    );

    return {
      provider: this.name,
      providerDisplayName: this.displayName,
      executionMode: this.executionMode,
      realExecution: true,
      actualModelId: runningModel?.model || runningModel?.name || this.actualModelId,
      status: runningModel ? "running" : "stopped",
      modelDigest: runningModel?.digest || null,
      checkedAt: new Date().toISOString()
    };
  }

  async chat({ workspace, message }) {
    const health = await this.getStatus();
    if (health.status !== "running") {
      throw new OllamaProviderError(
        `Ollama model "${this.actualModelId}" is not running. Start the runtime again.`,
        { status: 409 }
      );
    }

    const payload = await this.request("/api/chat", {
      method: "POST",
      body: JSON.stringify({
        model: this.actualModelId,
        stream: false,
        think: false,
        keep_alive: this.keepAlive,
        messages: [
          {
            role: "system",
            content:
              `You are the development model ${this.actualModelId}. ` +
              "You are not GLM-5.2. Answer the user directly and concisely."
          },
          { role: "user", content: message }
        ]
      })
    });

    const content = String(payload.message?.content || "").trim();
    if (!content) {
      throw new OllamaProviderError("Ollama returned a chat response without assistant content");
    }

    return {
      id: randomUUID(),
      role: "assistant",
      content,
      provider: this.name,
      providerDisplayName: this.displayName,
      executionMode: this.executionMode,
      realExecution: true,
      requestedModelId: workspace.baseModel.id,
      actualModelId: payload.model || this.actualModelId,
      modelState: workspace.run.modelState,
      createdAt: payload.created_at || new Date().toISOString(),
      metrics: {
        totalDuration: payload.total_duration ?? null,
        promptTokens: payload.prompt_eval_count ?? null,
        completionTokens: payload.eval_count ?? null
      }
    };
  }

  async stop({ workspace }) {
    await this.request("/api/generate", {
      method: "POST",
      body: JSON.stringify({
        model: this.actualModelId,
        prompt: "",
        stream: false,
        keep_alive: 0
      })
    });

    const deadline = Date.now() + this.startTimeoutMs;
    let health;
    do {
      health = await this.getStatus();
      if (health.status === "stopped") break;
      if (Date.now() >= deadline) {
        throw new OllamaProviderError(
          `Ollama did not unload model "${this.actualModelId}" within ${this.startTimeoutMs}ms`
        );
      }
      await wait(this.pollIntervalMs);
    } while (true);

    return {
      ...workspace.run,
      ...health,
      modelDigest: health.modelDigest || workspace.run.modelDigest || null,
      status: "stopped",
      stoppedAt: new Date().toISOString()
    };
  }
}
