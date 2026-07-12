import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import net from "node:net";
import path from "node:path";

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

export class MlxProviderError extends Error {
  constructor(message, { status = 503, cause } = {}) {
    super(message, { cause });
    this.name = "MlxProviderError";
    this.status = status;
  }
}

export class MlxComputeProvider {
  name = "mlx";
  displayName = "MLX-LM";
  executionMode = "real";
  realExecution = true;
  supportsAdaptedState = true;
  hardware = "Local Apple Silicon via MLX";

  constructor({
    modelPath,
    modelId,
    modelRevision,
    serverCommand,
    startTimeoutMs = 120_000,
    pollIntervalMs = 250,
    fetchImpl = globalThis.fetch,
    spawnImpl = spawn,
    portFactory = availablePort
  } = {}) {
    if (!String(modelPath || "").trim()) throw new TypeError("MLX_MODEL_PATH is required");
    if (!String(serverCommand || "").trim()) throw new TypeError("MLX_SERVER_COMMAND is required");
    if (!String(modelId || "").trim() || !String(modelRevision || "").trim()) {
      throw new TypeError("MLX model identity and revision are required");
    }
    if (!Number.isFinite(startTimeoutMs) || startTimeoutMs <= 0) {
      throw new TypeError("MLX_START_TIMEOUT_MS must be a positive number");
    }
    this.modelPath = path.resolve(modelPath);
    this.modelId = modelId;
    this.modelRevision = modelRevision;
    this.actualModelId = `${modelId}@${modelRevision}`;
    this.serverCommand = serverCommand;
    this.startTimeoutMs = startTimeoutMs;
    this.pollIntervalMs = pollIntervalMs;
    this.fetchImpl = fetchImpl;
    this.spawnImpl = spawnImpl;
    this.portFactory = portFactory;
    this.processes = new Map();
  }

  async request(endpoint, pathname, options = {}) {
    let response;
    try {
      response = await this.fetchImpl(`${endpoint}${pathname}`, {
        ...options,
        headers: { "content-type": "application/json", ...(options.headers || {}) },
        signal: options.signal || AbortSignal.timeout(this.startTimeoutMs)
      });
    } catch (error) {
      throw new MlxProviderError(`MLX-LM backend is unavailable at ${endpoint}: ${error.message}`, {
        cause: error
      });
    }
    const raw = await response.text();
    let payload = {};
    if (raw) {
      try {
        payload = JSON.parse(raw);
      } catch {
        throw new MlxProviderError(`MLX-LM returned invalid JSON from ${pathname}`);
      }
    }
    if (!response.ok) {
      throw new MlxProviderError(
        payload.detail || payload.error?.message || payload.error ||
          `MLX-LM request failed with HTTP ${response.status}`,
        { status: response.status >= 500 ? 503 : response.status }
      );
    }
    return payload;
  }

  async start({ workspace, modelState, runId }) {
    if (workspace.baseModel.id !== this.modelId || workspace.baseModel.revision !== this.modelRevision) {
      throw new MlxProviderError("Workspace lineage does not match the configured MLX base revision", {
        status: 409
      });
    }
    try {
      await access(this.modelPath);
    } catch {
      throw new MlxProviderError(`Pinned MLX model is not available at ${this.modelPath}`);
    }

    let adapter = null;
    if (modelState === "adapted") {
      adapter = workspace.adaptation;
      if (adapter?.status !== "complete" || !adapter.adapterPath) {
        throw new MlxProviderError("The adapted state is unavailable until real training completes", {
          status: 409
        });
      }
      try {
        await access(path.join(adapter.adapterPath, "adapters.safetensors"));
      } catch {
        throw new MlxProviderError("Adapter weights are missing; adapted inference will not fall back to base", {
          status: 409
        });
      }
    }

    const id = runId || randomUUID();
    const port = await this.portFactory();
    const backendEndpoint = `http://127.0.0.1:${port}`;
    const args = [
      "--model", this.modelPath,
      "--host", "127.0.0.1",
      "--port", String(port),
      "--max-tokens", "256",
      "--chat-template-args", JSON.stringify({ enable_thinking: false })
    ];
    if (adapter) args.push("--adapter-path", adapter.adapterPath);

    const child = this.spawnImpl(this.serverCommand, args, {
      cwd: path.dirname(this.modelPath),
      stdio: ["ignore", "pipe", "pipe"]
    });
    const record = { child, logs: "", exited: false, spawnError: null };
    this.processes.set(id, record);
    child.stdout?.on("data", (chunk) => { record.logs = `${record.logs}${chunk}`.slice(-12_000); });
    child.stderr?.on("data", (chunk) => { record.logs = `${record.logs}${chunk}`.slice(-12_000); });
    child.once?.("exit", () => { record.exited = true; });
    child.once?.("error", (error) => { record.spawnError = error; });

    const deadline = Date.now() + this.startTimeoutMs;
    try {
      while (Date.now() < deadline) {
        if (record.spawnError) {
          throw new MlxProviderError(`Could not start MLX-LM server: ${record.spawnError.message}`);
        }
        if (record.exited) throw new MlxProviderError(`MLX-LM server exited during start: ${record.logs}`);
        try {
          await this.request(backendEndpoint, "/v1/models", {
            signal: AbortSignal.timeout(Math.min(2_000, this.pollIntervalMs * 4))
          });
          const startedAt = new Date().toISOString();
          return {
            id,
            provider: this.name,
            providerDisplayName: this.displayName,
            executionMode: this.executionMode,
            realExecution: true,
            status: "running",
            requestedModelId: workspace.baseModel.id,
            actualModelId: this.actualModelId,
            baseModelId: this.modelId,
            baseRevision: this.modelRevision,
            developmentModel: false,
            modelState: modelState === "adapted"
              ? { kind: "adapted", label: adapter.name, adaptationId: adapter.id }
              : { kind: "base", label: `${workspace.baseModel.name} base`, adaptationId: null },
            adapter: adapter ? {
              id: adapter.id,
              path: adapter.adapterPath,
              sha256: adapter.adapterSha256
            } : null,
            endpoint: `/api/workspaces/${workspace.id}/chat`,
            backendEndpoint,
            processId: child.pid || null,
            hardware: this.hardware,
            startingAt: workspace.run?.startingAt || startedAt,
            startedAt,
            checkedAt: startedAt,
            note: adapter
              ? `Real inference through MLX-LM using the pinned base and adapter ${adapter.id}.`
              : "Real inference through MLX-LM using the pinned base revision."
          };
        } catch (error) {
          if (!(error instanceof MlxProviderError) || !error.message.includes("unavailable")) throw error;
        }
        await wait(this.pollIntervalMs);
      }
      throw new MlxProviderError(`MLX-LM did not become healthy within ${this.startTimeoutMs}ms`);
    } catch (error) {
      child.kill?.("SIGTERM");
      this.processes.delete(id);
      throw error;
    }
  }

  async getStatus({ workspace }) {
    const run = workspace.run;
    const record = this.processes.get(run?.id);
    if (record?.exited) {
      return { status: "stopped", checkedAt: new Date().toISOString() };
    }
    await this.request(run.backendEndpoint, "/v1/models", {
      signal: AbortSignal.timeout(2_000)
    });
    return {
      provider: this.name,
      providerDisplayName: this.displayName,
      executionMode: this.executionMode,
      realExecution: true,
      actualModelId: this.actualModelId,
      baseModelId: this.modelId,
      baseRevision: this.modelRevision,
      status: "running",
      checkedAt: new Date().toISOString()
    };
  }

  async chat({ workspace, message }) {
    const health = await this.getStatus({ workspace });
    if (health.status !== "running") {
      throw new MlxProviderError("MLX-LM runtime is not running", { status: 409 });
    }
    const payload = await this.request(workspace.run.backendEndpoint, "/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({
        model: this.modelPath,
        messages: [{ role: "user", content: message }],
        max_tokens: 160,
        temperature: 0
      })
    });
    const content = String(payload.choices?.[0]?.message?.content || "").trim();
    if (!content) throw new MlxProviderError("MLX-LM returned no assistant content");
    return {
      id: payload.id || randomUUID(),
      role: "assistant",
      content,
      provider: this.name,
      providerDisplayName: this.displayName,
      executionMode: this.executionMode,
      realExecution: true,
      requestedModelId: workspace.baseModel.id,
      actualModelId: this.actualModelId,
      baseModelId: this.modelId,
      baseRevision: this.modelRevision,
      adapter: workspace.run.adapter,
      modelState: workspace.run.modelState,
      createdAt: new Date().toISOString(),
      metrics: {
        promptTokens: payload.usage?.prompt_tokens ?? null,
        completionTokens: payload.usage?.completion_tokens ?? null
      }
    };
  }

  async stop({ workspace }) {
    const record = this.processes.get(workspace.run.id);
    if (record && !record.exited) {
      const exited = new Promise((resolve) => record.child.once("exit", resolve));
      record.child.kill("SIGTERM");
      await Promise.race([exited, wait(5_000)]);
      if (!record.exited) record.child.kill("SIGKILL");
    }
    this.processes.delete(workspace.run.id);
    return {
      ...workspace.run,
      status: "stopped",
      checkedAt: new Date().toISOString(),
      stoppedAt: new Date().toISOString()
    };
  }
}
