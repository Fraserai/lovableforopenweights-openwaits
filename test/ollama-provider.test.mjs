import test from "node:test";
import assert from "node:assert/strict";
import { OllamaComputeProvider } from "../lib/compute/ollama-provider.mjs";
import { startFakeOllama } from "./helpers/fake-ollama.mjs";

function workspaceFixture() {
  return {
    id: "workspace-test",
    baseModel: { id: "zai-org/glm-5.2", name: "GLM-5.2" },
    adaptation: null,
    run: { startingAt: "2026-07-12T00:00:00.000Z" }
  };
}

test("Ollama provider validates configuration", () => {
  assert.throws(
    () => new OllamaComputeProvider(),
    /OLLAMA_MODEL is required/
  );
  assert.throws(
    () => new OllamaComputeProvider({ model: "qwen3:0.6b", baseUrl: "file:///tmp/ollama" }),
    /must use HTTP or HTTPS/
  );
  assert.throws(
    () => new OllamaComputeProvider({ model: "qwen3:0.6b", baseUrl: "https://secret@example.com" }),
    /use OLLAMA_API_KEY/
  );
  assert.throws(
    () => new OllamaComputeProvider({ model: "qwen3:0.6b", startTimeoutMs: 0 }),
    /positive number/
  );
  const remote = new OllamaComputeProvider({
    model: "qwen3:0.6b",
    baseUrl: "https://ollama.example/api"
  });
  assert.equal(remote.baseUrl, "https://ollama.example");
  assert.equal(remote.hardware, "Remote Ollama endpoint");
});

test("Ollama provider polls through the health transition", async () => {
  const backend = await startFakeOllama({ healthyAfterPs: 1 });
  try {
    const provider = new OllamaComputeProvider({
      baseUrl: backend.baseUrl,
      model: backend.state.model,
      startTimeoutMs: 1_000,
      pollIntervalMs: 5
    });
    const run = await provider.start({
      workspace: workspaceFixture(),
      modelState: "base",
      runId: "run-test"
    });

    assert.equal(run.id, "run-test");
    assert.equal(run.status, "running");
    assert.equal(run.provider, "ollama");
    assert.equal(run.executionMode, "real");
    assert.equal(run.realExecution, true);
    assert.equal(run.actualModelId, "qwen3:0.6b");
    assert.equal(run.requestedModelId, "zai-org/glm-5.2");
    assert.equal(run.developmentModel, true);
    assert.ok(backend.state.psCalls >= 2);
  } finally {
    await backend.stop();
  }
});

test("Ollama provider parses a real chat-shaped response with identity metadata", async () => {
  const backend = await startFakeOllama();
  try {
    const provider = new OllamaComputeProvider({
      baseUrl: backend.baseUrl,
      model: backend.state.model,
      startTimeoutMs: 1_000,
      pollIntervalMs: 5
    });
    const workspace = workspaceFixture();
    workspace.run = await provider.start({ workspace, modelState: "base" });
    const message = await provider.chat({ workspace, message: "Who are you?" });

    assert.equal(message.content, "Backend-generated development response.");
    assert.equal(message.providerDisplayName, "Ollama");
    assert.equal(message.actualModelId, "qwen3:0.6b");
    assert.equal(message.realExecution, true);
    assert.equal(message.metrics.promptTokens, 8);
    assert.equal(backend.state.lastChatBody.stream, false);
    assert.match(backend.state.lastChatBody.messages[0].content, /not the pinned/i);
  } finally {
    await backend.stop();
  }
});

test("Ollama provider unloads the model on stop", async () => {
  const backend = await startFakeOllama();
  try {
    const provider = new OllamaComputeProvider({
      baseUrl: backend.baseUrl,
      model: backend.state.model,
      startTimeoutMs: 1_000,
      pollIntervalMs: 5
    });
    const workspace = workspaceFixture();
    workspace.run = await provider.start({ workspace, modelState: "base" });
    const stopped = await provider.stop({ workspace });

    assert.equal(stopped.status, "stopped");
    assert.equal(stopped.modelDigest, "sha256:test-model");
    assert.equal(backend.state.loaded, false);
    assert.equal(backend.state.stopCalls, 1);
  } finally {
    await backend.stop();
  }
});

test("Ollama provider reports backend failure without fallback", async () => {
  const provider = new OllamaComputeProvider({
    baseUrl: "http://127.0.0.1:1",
    model: "qwen3:0.6b",
    startTimeoutMs: 100,
    pollIntervalMs: 5
  });
  await assert.rejects(
    provider.start({ workspace: workspaceFixture(), modelState: "base" }),
    /Ollama backend is unavailable/
  );
});

test("Ollama provider rejects adapted execution until training exists", async () => {
  const provider = new OllamaComputeProvider({ model: "qwen3:0.6b" });
  await assert.rejects(
    provider.start({ workspace: workspaceFixture(), modelState: "adapted" }),
    /adaptation training has not been implemented/
  );
});
