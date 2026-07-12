import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = path.dirname(fileURLToPath(new URL("../package.json", import.meta.url)));

async function startTestServer() {
  const dataDir = await mkdtemp(path.join(tmpdir(), "openweight-mvp-"));
  const server = spawn(process.execPath, ["server.mjs"], {
    cwd: projectDir,
    env: {
      ...process.env,
      PORT: "0",
      OPENWEIGHT_DATA_FILE: path.join(dataDir, "workspaces.json")
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
  } finally {
    await app.stop();
  }
});
