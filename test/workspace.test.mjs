import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startFakeOllama } from "./helpers/fake-ollama.mjs";

const projectDir = path.dirname(fileURLToPath(new URL("../package.json", import.meta.url)));

async function startTestServer(extraEnv = {}) {
  const dataDir = await mkdtemp(path.join(tmpdir(), "openweight-mvp-"));
  const server = spawn(process.execPath, ["server.mjs"], {
    cwd: projectDir,
    env: {
      ...process.env,
      PORT: "0",
      OPENWEIGHT_DATA_FILE: path.join(dataDir, "workspaces.json"),
      COMPUTE_PROVIDER: "mock",
      ...extraEnv
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  const baseUrl = await new Promise((resolve, reject) => {
    let stderr = "";
    const timeout = setTimeout(() => reject(new Error(`Server start timed out: ${stderr}`)), 5000);
    server.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    server.once("error", reject);
    server.stdout.on("data", (chunk) => {
      const match = chunk.toString().match(/http:\/\/localhost:(\d+)/);
      if (!match) return;
      clearTimeout(timeout);
      resolve(`http://localhost:${match[1]}`);
    });
  });

  return {
    baseUrl,
    async stop() {
      const exited = new Promise((resolve) => server.once("exit", resolve));
      server.kill("SIGTERM");
      await exited;
      await rm(dataDir, { recursive: true, force: true });
    }
  };
}

async function request(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    headers: { "content-type": "application/json" },
    ...options
  });
  const payload = await response.json();
  return { response, payload };
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

test("Choose -> Fork -> Adapt -> Run completes an honest simulated playground request", async () => {
  const app = await startTestServer();

  try {
    const modelsResult = await request(app.baseUrl, "/api/models");
    assert.equal(modelsResult.response.status, 200);
    const chosenModel = modelsResult.payload.models.at(0);
    assert.equal(chosenModel.id, "zai-org/glm-5.2");
    assert.match(chosenModel.revision, /^[a-f0-9]{40}$/);

    const forkResult = await request(app.baseUrl, "/api/workspaces", {
      method: "POST",
      body: JSON.stringify({ modelId: chosenModel.id, name: "Research GLM" })
    });
    assert.equal(forkResult.response.status, 201);
    const fork = forkResult.payload.workspace;
    assert.equal(fork.phase, "forked");
    assert.equal(fork.lineage.parentModelId, chosenModel.id);
    assert.equal(fork.lineage.parentRevision, chosenModel.revision);
    assert.equal(fork.baseModel.revision, chosenModel.revision);

    const prematureRun = await request(app.baseUrl, `/api/workspaces/${fork.id}/run`, {
      method: "POST",
      body: JSON.stringify({ modelState: "adapted" })
    });
    assert.equal(prematureRun.response.status, 409);

    const objective = "Explain open-weight model architecture and turn ideas into practical experiments.";
    const adaptResult = await request(app.baseUrl, `/api/workspaces/${fork.id}/adapt`, {
      method: "POST",
      body: JSON.stringify({ name: "Research specialist", objective })
    });
    assert.equal(adaptResult.response.status, 200);
    const adapted = adaptResult.payload.workspace;
    assert.equal(adapted.phase, "adapted");
    assert.equal(adapted.adaptation.method, "lora");
    assert.equal(adapted.adaptation.objective, objective);
    assert.equal(adapted.adaptation.status, "specification-created");

    const runResult = await request(app.baseUrl, `/api/workspaces/${fork.id}/run`, {
      method: "POST",
      body: JSON.stringify({ modelState: "adapted" })
    });
    assert.equal(runResult.response.status, 200);
    const running = runResult.payload.workspace;
    assert.equal(running.phase, "running");
    assert.equal(running.run.status, "running");
    assert.equal(running.run.executionMode, "simulation");
    assert.equal(running.run.modelState.kind, "adapted");
    assert.equal(running.run.modelState.adaptationId, adapted.adaptation.id);
    assert.match(running.run.note, /no model weights.*training.*GPU inference/i);

    const chatResult = await request(app.baseUrl, `/api/workspaces/${fork.id}/chat`, {
      method: "POST",
      body: JSON.stringify({ message: "Design a small experiment." })
    });
    assert.equal(chatResult.response.status, 200);
    assert.equal(chatResult.payload.message.executionMode, "simulation");
    assert.equal(chatResult.payload.message.modelState.kind, "adapted");
    assert.match(chatResult.payload.message.content, /^Simulated response/);
    assert.match(chatResult.payload.message.content, /No GLM-5.2 inference was performed/);

    const persistedResult = await request(app.baseUrl, `/api/workspaces/${fork.id}`);
    assert.equal(persistedResult.payload.workspace.run.id, running.run.id);
    assert.equal(persistedResult.payload.workspace.baseModel.revision, chosenModel.revision);

    const stopResult = await request(app.baseUrl, `/api/workspaces/${fork.id}/stop`, {
      method: "POST",
      body: "{}"
    });
    assert.equal(stopResult.payload.workspace.run.status, "stopped");
    assert.equal(stopResult.payload.workspace.run.realExecution, false);
  } finally {
    await app.stop();
  }
});

test("API preserves real Ollama model identity through start, chat, status, and stop", async () => {
  const backend = await startFakeOllama({ healthyAfterPs: 3 });
  const app = await startTestServer({
    COMPUTE_PROVIDER: "ollama",
    OLLAMA_BASE_URL: backend.baseUrl,
    OLLAMA_MODEL: backend.state.model,
    OLLAMA_START_TIMEOUT_MS: "1000",
    OLLAMA_POLL_INTERVAL_MS: "20"
  });

  try {
    const healthResult = await request(app.baseUrl, "/api/health");
    assert.equal(healthResult.payload.runtime.provider, "ollama");
    assert.equal(healthResult.payload.runtime.actualModelId, "qwen3:0.6b");
    assert.equal(healthResult.payload.runtime.realExecution, true);
    assert.equal(healthResult.payload.runtime.supportsAdaptedState, false);

    const modelsResult = await request(app.baseUrl, "/api/models");
    const chosenModel = modelsResult.payload.models.at(0);
    const forkResult = await request(app.baseUrl, "/api/workspaces", {
      method: "POST",
      body: JSON.stringify({ modelId: chosenModel.id, name: "Real development proof" })
    });
    const fork = forkResult.payload.workspace;

    const runRequest = request(app.baseUrl, `/api/workspaces/${fork.id}/run`, {
      method: "POST",
      body: JSON.stringify({ modelState: "base" })
    });
    let startingWorkspace;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const current = await request(app.baseUrl, `/api/workspaces/${fork.id}`);
      if (current.payload.workspace.run?.status === "starting") {
        startingWorkspace = current.payload.workspace;
        break;
      }
      await wait(5);
    }
    assert.equal(startingWorkspace.run.status, "starting");
    assert.equal(startingWorkspace.run.actualModelId, "qwen3:0.6b");
    assert.equal(startingWorkspace.run.realExecution, true);

    const runResult = await runRequest;
    assert.equal(runResult.response.status, 200);
    const run = runResult.payload.workspace.run;
    assert.equal(run.status, "running");
    assert.equal(run.provider, "ollama");
    assert.equal(run.realExecution, true);
    assert.equal(run.actualModelId, "qwen3:0.6b");
    assert.equal(run.requestedModelId, "zai-org/glm-5.2");
    assert.equal(run.developmentModel, true);

    const statusResult = await request(app.baseUrl, `/api/workspaces/${fork.id}/run/status`);
    assert.equal(statusResult.payload.workspace.run.status, "running");
    assert.equal(statusResult.payload.workspace.run.actualModelId, "qwen3:0.6b");

    const chatResult = await request(app.baseUrl, `/api/workspaces/${fork.id}/chat`, {
      method: "POST",
      body: JSON.stringify({ message: "Identify the executing model." })
    });
    assert.equal(chatResult.payload.message.providerDisplayName, "Ollama");
    assert.equal(chatResult.payload.message.actualModelId, "qwen3:0.6b");
    assert.equal(chatResult.payload.message.realExecution, true);
    assert.notEqual(chatResult.payload.message.actualModelId, chosenModel.id);

    const stopResult = await request(app.baseUrl, `/api/workspaces/${fork.id}/stop`, {
      method: "POST",
      body: "{}"
    });
    assert.equal(stopResult.payload.workspace.run.status, "stopped");
    assert.equal(stopResult.payload.workspace.run.realExecution, true);
    assert.equal(backend.state.loaded, false);
  } finally {
    await app.stop();
    await backend.stop();
  }
});

test("API persists a truthful failed real state when Ollama is unavailable", async () => {
  const app = await startTestServer({
    COMPUTE_PROVIDER: "ollama",
    OLLAMA_BASE_URL: "http://127.0.0.1:1",
    OLLAMA_MODEL: "qwen3:0.6b",
    OLLAMA_START_TIMEOUT_MS: "100"
  });

  try {
    const modelsResult = await request(app.baseUrl, "/api/models");
    const forkResult = await request(app.baseUrl, "/api/workspaces", {
      method: "POST",
      body: JSON.stringify({
        modelId: modelsResult.payload.models.at(0).id,
        name: "Unavailable backend proof"
      })
    });
    const fork = forkResult.payload.workspace;
    const runResult = await request(app.baseUrl, `/api/workspaces/${fork.id}/run`, {
      method: "POST",
      body: JSON.stringify({ modelState: "base" })
    });
    assert.equal(runResult.response.status, 503);
    assert.match(runResult.payload.error, /Ollama backend is unavailable/);

    const persistedResult = await request(app.baseUrl, `/api/workspaces/${fork.id}`);
    const failedRun = persistedResult.payload.workspace.run;
    assert.equal(failedRun.status, "failed");
    assert.equal(failedRun.provider, "ollama");
    assert.equal(failedRun.actualModelId, "qwen3:0.6b");
    assert.equal(failedRun.realExecution, true);
    assert.match(failedRun.error, /Ollama backend is unavailable/);
  } finally {
    await app.stop();
  }
});
