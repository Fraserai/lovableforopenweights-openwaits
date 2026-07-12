import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  TogetherManagedProvider,
  mapFineTuneStatus
} from "../lib/compute/together-provider.mjs";
import { prepareTogetherDataset } from "../lib/adaptation/together-dataset.mjs";

const MODEL_ID = "Qwen/Qwen3-0.6B";
const OUTPUT_MODEL = "owner/Qwen3-0.6B-openweight-abc123";
const examples = Array.from({ length: 5 }, (_, index) => ({
  user: `User ${index + 1}`,
  assistant: `Assistant ${index + 1}`
}));

function workspace(fineTune = null) {
  return {
    id: "workspace-together",
    baseModel: {
      id: MODEL_ID,
      name: "Qwen3 0.6B",
      sourceModelId: MODEL_ID,
      providerModelId: MODEL_ID,
      provider: "together",
      revision: null
    },
    fineTune,
    run: { startingAt: "2026-07-13T00:00:00.000Z" }
  };
}

function fakeClient({ serverless = false, fineTuneStatus = "queued", processed = true } = {}) {
  const calls = {
    upload: [], fineTuneCreate: [], hardware: [], endpointCreate: [], endpointRetrieve: 0,
    endpointDelete: [], chats: []
  };
  const client = {
    models: {
      list: async () => [{ id: MODEL_ID, pricing: { finetune: 0.6 } }]
    },
    files: {
      upload: async (...args) => {
        calls.upload.push(args);
        if (processed === "error") throw new Error("dataset validation failed");
        return { id: "file-real", Processed: processed, bytes: 100 };
      },
      retrieve: async () => ({ id: "file-real", Processed: processed, bytes: 100 })
    },
    fineTuning: {
      create: async (params) => {
        calls.fineTuneCreate.push(params);
        return { id: "ft-real", status: "queued" };
      },
      retrieve: async () => ({
        id: "ft-real",
        status: fineTuneStatus,
        model_output_name: fineTuneStatus === "completed" ? OUTPUT_MODEL : undefined,
        started_at: "2026-07-13T00:01:00.000Z",
        updated_at: "2026-07-13T00:02:00.000Z"
      })
    },
    endpoints: {
      listHardware: async ({ model }) => {
        calls.hardware.push(model);
        return {
          data: [{
            id: "1x_nvidia_l40s",
            pricing: { cents_per_minute: 10 },
            specs: { gpu_count: 1, gpu_memory: 48 },
            availability: { status: "available" }
          }]
        };
      },
      list: async () => ({
        data: serverless ? [{ model: MODEL_ID, name: MODEL_ID, type: "serverless" }] : []
      }),
      create: async (params) => {
        calls.endpointCreate.push(params);
        return {
          id: "endpoint-real", name: "endpoint-model-name", model: params.model,
          state: "STARTING", hardware: params.hardware
        };
      },
      retrieve: async () => {
        calls.endpointRetrieve += 1;
        return {
          id: "endpoint-real", name: "endpoint-model-name", model: OUTPUT_MODEL,
          state: "STARTED", hardware: "1x_nvidia_l40s"
        };
      },
      delete: async (id) => { calls.endpointDelete.push(id); }
    },
    chat: {
      completions: {
        create: async (params) => {
          calls.chats.push(params);
          return {
            id: "chat-real",
            choices: [{ message: { content: "Genuine Together response." } }],
            usage: { prompt_tokens: 8, completion_tokens: 4 }
          };
        }
      }
    }
  };
  return { client, calls };
}

function providerWith(fake, root, overrides = {}) {
  return new TogetherManagedProvider({
    apiKey: "server-secret",
    modelId: MODEL_ID,
    client: fake.client,
    artifactsRoot: root,
    pollIntervalMs: 1,
    fileTimeoutMs: 5,
    endpointTimeoutMs: 50,
    ...overrides
  });
}

test("Together dataset validation writes all 5-20 conversation examples", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "together-data-"));
  try {
    const target = path.join(root, "training.jsonl");
    const prepared = await prepareTogetherDataset(examples, target);
    const records = (await readFile(target, "utf8")).trim().split("\n").map(JSON.parse);
    assert.equal(prepared.exampleCount, 5);
    assert.equal(records.length, 5);
    assert.deepEqual(records[0].messages[1], { role: "assistant", content: "Assistant 1" });
    await assert.rejects(prepareTogetherDataset(examples.slice(0, 4), target), /between 5 and 20/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Together provider validates server-only configuration and maps job states", () => {
  assert.throws(() => new TogetherManagedProvider({ modelId: MODEL_ID }), /TOGETHER_API_KEY/);
  assert.deepEqual(
    ["pending", "queued", "running", "compressing", "uploading", "completed", "error", "cancelled"]
      .map(mapFineTuneStatus),
    ["queued", "queued", "training", "publishing", "publishing", "complete", "failed", "cancelled"]
  );
});

test("Together upload, validation, LoRA creation, status, and output identity are persisted-shaped", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "together-ft-"));
  const fake = fakeClient({ fineTuneStatus: "completed" });
  try {
    const provider = providerWith(fake, root);
    const fineTune = await provider.prepareFineTune({
      workspace: workspace(), name: "Cloud specialist", objective: "Be concise", examples
    });
    assert.equal(fineTune.status, "preparing");
    assert.equal(fineTune.method, "lora");
    const file = await provider.uploadTrainingFile(fineTune.datasetPath);
    assert.equal(file.id, "file-real");
    const job = await provider.createFineTune({
      fileId: file.id, workspace: workspace(), adaptation: fineTune
    });
    assert.equal(job.id, "ft-real");
    assert.equal(fake.calls.fineTuneCreate[0].training_type.type, "Lora");
    const status = await provider.getFineTune(job.id);
    assert.equal(status.status, "complete");
    assert.equal(status.outputModelId, OUTPUT_MODEL);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Together reports provider file-validation failure", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "together-invalid-"));
  const fake = fakeClient({ processed: "error" });
  try {
    const provider = providerWith(fake, root);
    await assert.rejects(provider.uploadTrainingFile("/tmp/training.jsonl"), /dataset validation failed/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Together runs base serverless and fine-tuned dedicated identities without fallback", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "together-run-"));
  try {
    const baseFake = fakeClient({ serverless: true });
    const baseProvider = providerWith(baseFake, root);
    const baseWorkspace = workspace();
    const baseRun = await baseProvider.start({ workspace: baseWorkspace, modelState: "base" });
    assert.equal(baseRun.endpointType, "serverless");
    assert.equal(baseRun.actualModelId, MODEL_ID);

    const dedicatedFake = fakeClient();
    const provider = providerWith(dedicatedFake, root);
    const fineTune = {
      id: "fine-one", name: "Cloud specialist", status: "complete",
      outputModelId: OUTPUT_MODEL, fineTuneJobId: "ft-real"
    };
    const tunedWorkspace = workspace(fineTune);
    let persistedEndpoint;
    const run = await provider.start({
      workspace: tunedWorkspace,
      modelState: "fine-tuned",
      onEndpointCreated: async (endpoint) => { persistedEndpoint = endpoint; }
    });
    assert.equal(run.actualModelId, OUTPUT_MODEL);
    assert.equal(run.endpointId, "endpoint-real");
    assert.equal(run.endpointModelName, "endpoint-model-name");
    assert.equal(persistedEndpoint.endpointId, "endpoint-real");
    assert.equal(persistedEndpoint.endpointState, "STARTING");
    assert.equal(dedicatedFake.calls.endpointCreate[0].hardware, "1x_nvidia_l40s");
    tunedWorkspace.run = run;
    const history = [
      { role: "user", content: "First" },
      { role: "assistant", content: "Earlier reply" },
      { role: "user", content: "Second" }
    ];
    const message = await provider.chat({ workspace: tunedWorkspace, messages: history });
    assert.equal(message.endpointModelName, "endpoint-model-name");
    assert.deepEqual(dedicatedFake.calls.chats[0].messages, history);
    assert.equal(dedicatedFake.calls.chats[0].model, "endpoint-model-name");
    const stopped = await provider.stop({ workspace: tunedWorkspace });
    assert.equal(stopped.status, "stopped");
    assert.deepEqual(dedicatedFake.calls.endpointDelete, ["endpoint-real"]);

    await assert.rejects(
      provider.start({
        workspace: workspace({ id: "incomplete", status: "failed", outputModelId: null }),
        modelState: "fine-tuned"
      }),
      /unavailable until Together publishes/
    );
    assert.equal(dedicatedFake.calls.endpointCreate.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
