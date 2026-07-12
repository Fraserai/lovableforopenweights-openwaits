import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { MlxComputeProvider } from "../lib/compute/mlx-provider.mjs";
const model = {
  id: "mlx-community/Qwen3-0.6B-4bit",
  name: "Qwen3 0.6B",
  revision: "73e3e38d981303bc594367cd910ea6eb48349da8"
};

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.pid = 1234;
  child.kill = (signal) => {
    queueMicrotask(() => child.emit("exit", 0, signal));
    return true;
  };
  return child;
}

function workspace(modelPath, adaptation = null) {
  return {
    id: "workspace-mlx",
    baseModel: { id: model.id, name: model.name, revision: model.revision },
    adaptation,
    run: { startingAt: "2026-07-12T00:00:00.000Z" },
    modelPath
  };
}

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "openweight-mlx-"));
  const modelPath = path.join(root, "model");
  await mkdir(modelPath);
  let serverArgs;
  const child = fakeChild();
  const requests = [];
  const provider = new MlxComputeProvider({
    modelPath,
    modelId: model.id,
    modelRevision: model.revision,
    serverCommand: "/fake/mlx_lm.server",
    pollIntervalMs: 1,
    startTimeoutMs: 100,
    portFactory: async () => 9898,
    spawnImpl: (_command, args) => { serverArgs = args; return child; },
    fetchImpl: async (url, options = {}) => {
      requests.push({ url, options });
      if (url.endsWith("/v1/models")) {
        return new Response(JSON.stringify({ data: [{ id: model.id }] }), { status: 200 });
      }
      return new Response(JSON.stringify({
        id: "chat-real",
        choices: [{ message: { role: "assistant", content: "A genuine parsed response." } }],
        usage: { prompt_tokens: 4, completion_tokens: 5 }
      }), { status: 200 });
    }
  });
  return { root, modelPath, provider, child, requests, get serverArgs() { return serverArgs; } };
}

test("MLX provider validates configuration", () => {
  assert.throws(() => new MlxComputeProvider(), /MLX_MODEL_PATH is required/);
  assert.throws(
    () => new MlxComputeProvider({ modelPath: "/tmp/model", serverCommand: "/bin/false" }),
    /model identity and revision/
  );
});

test("MLX provider selects base or adapter explicitly, parses chat metadata, and stops", async () => {
  const testFixture = await fixture();
  try {
    const baseWorkspace = workspace(testFixture.modelPath);
    const baseRun = await testFixture.provider.start({
      workspace: baseWorkspace, modelState: "base", runId: "base-run"
    });
    assert.equal(baseRun.status, "running");
    assert.equal(baseRun.baseRevision, model.revision);
    assert.equal(testFixture.serverArgs.includes("--adapter-path"), false);
    baseWorkspace.run = baseRun;
    const message = await testFixture.provider.chat({ workspace: baseWorkspace, message: "Hello" });
    assert.equal(message.content, "A genuine parsed response.");
    assert.equal(message.realExecution, true);
    assert.equal(message.baseRevision, model.revision);
    assert.equal(message.adapter, null);
    const stopped = await testFixture.provider.stop({ workspace: baseWorkspace });
    assert.equal(stopped.status, "stopped");
  } finally {
    await rm(testFixture.root, { recursive: true, force: true });
  }

  const adaptedFixture = await fixture();
  try {
    const adapterPath = path.join(adaptedFixture.root, "adapter");
    await mkdir(adapterPath);
    await writeFile(path.join(adapterPath, "adapters.safetensors"), "weights");
    const adaptation = {
      id: "adapter-one", name: "Adapted specialist", status: "complete",
      adapterPath, adapterSha256: "sha256-adapter"
    };
    const adaptedWorkspace = workspace(adaptedFixture.modelPath, adaptation);
    const run = await adaptedFixture.provider.start({
      workspace: adaptedWorkspace, modelState: "adapted", runId: "adapted-run"
    });
    assert.deepEqual(
      adaptedFixture.serverArgs.slice(adaptedFixture.serverArgs.indexOf("--adapter-path")),
      ["--adapter-path", adapterPath]
    );
    assert.equal(run.modelState.kind, "adapted");
    assert.equal(run.adapter.id, adaptation.id);
    adaptedWorkspace.run = run;
    const message = await adaptedFixture.provider.chat({ workspace: adaptedWorkspace, message: "Hello" });
    assert.equal(message.adapter.sha256, "sha256-adapter");
  } finally {
    await rm(adaptedFixture.root, { recursive: true, force: true });
  }
});

test("MLX adapted start fails without complete weights and never falls back", async () => {
  const testFixture = await fixture();
  try {
    await assert.rejects(
      testFixture.provider.start({
        workspace: workspace(testFixture.modelPath, {
          id: "missing", name: "Missing", status: "complete", adapterPath: "/missing/adapter"
        }),
        modelState: "adapted"
      }),
      /weights are missing.*will not fall back/
    );
    assert.equal(testFixture.serverArgs, undefined);
  } finally {
    await rm(testFixture.root, { recursive: true, force: true });
  }
});
