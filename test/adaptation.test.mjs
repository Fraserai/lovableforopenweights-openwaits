import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { prepareExamples, validateExamples } from "../lib/adaptation/examples.mjs";
import { MlxAdaptationTrainer } from "../lib/adaptation/mlx-trainer.mjs";
const model = {
  id: "mlx-community/Qwen3-0.6B-4bit",
  name: "Qwen3 0.6B",
  revision: "73e3e38d981303bc594367cd910ea6eb48349da8"
};
const examples = Array.from({ length: 5 }, (_, index) => ({
  user: `Question ${index + 1}`,
  assistant: `Ideal answer ${index + 1}`
}));

function workspace(modelRevision = model.revision) {
  return {
    id: "fork-one",
    baseModel: { id: model.id, name: model.name, revision: modelRevision }
  };
}

test("adaptation examples require 5-20 complete user/assistant pairs", () => {
  assert.throws(() => validateExamples(examples.slice(0, 4)), /between 5 and 20/);
  assert.throws(
    () => validateExamples([...examples.slice(0, 4), { user: "Missing", assistant: "" }]),
    /needs both/
  );
  assert.equal(validateExamples(examples).length, 5);
  assert.throws(() => validateExamples([...examples, ...examples, ...examples, ...examples, examples[0]]), /between 5 and 20/);
});

test("example preparation writes MLX chat records with a held-out validation example", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "openweight-data-"));
  try {
    const prepared = await prepareExamples(examples, root);
    const train = (await readFile(path.join(root, "train.jsonl"), "utf8")).trim().split("\n");
    const valid = (await readFile(path.join(root, "valid.jsonl"), "utf8")).trim().split("\n");
    assert.equal(prepared.trainingCount, 4);
    assert.equal(train.length, 4);
    assert.equal(valid.length, 1);
    assert.deepEqual(JSON.parse(train[0]).messages[0], { role: "user", content: "Question 1" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("MLX trainer preserves exact lineage and completes only after adapter creation", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "openweight-train-"));
  const modelPath = path.join(root, "model");
  await mkdir(modelPath);
  try {
    const trainer = new MlxAdaptationTrainer({
      modelPath,
      modelId: model.id,
      modelRevision: model.revision,
      artifactsRoot: path.join(root, "artifacts"),
      loraCommand: "/fake/mlx_lm.lora",
      iterations: 2,
      processRunner: async (_command, args) => {
        const adapterPath = args[args.indexOf("--adapter-path") + 1];
        await writeFile(path.join(adapterPath, "adapters.safetensors"), "real-weights");
        await writeFile(path.join(adapterPath, "adapter_config.json"), "{}");
        return { code: 0, output: "42 maximum resident set size" };
      }
    });
    const training = await trainer.start({
      workspace: workspace(), name: "Specialist", objective: "Be exact", examples
    });
    assert.equal(training.adaptation.status, "training");
    assert.equal(training.adaptation.baseRevision, model.revision);
    const complete = await training.completion;
    assert.equal(complete.status, "complete");
    assert.equal(complete.adapterSizeBytes, 12);
    assert.equal(complete.peakMemoryBytes, 42);
    assert.match(complete.adapterSha256, /^[a-f0-9]{64}$/);

    await assert.rejects(
      trainer.start({
        workspace: workspace("wrong-revision"), name: "Wrong", objective: "Wrong", examples
      }),
      /lineage does not match/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("MLX trainer reports process failure and missing adapter artifacts", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "openweight-fail-"));
  const modelPath = path.join(root, "model");
  await mkdir(modelPath);
  const createTrainer = (processRunner) => new MlxAdaptationTrainer({
    modelPath,
    modelId: model.id,
    modelRevision: model.revision,
    artifactsRoot: path.join(root, randomName()),
    loraCommand: "/fake/mlx_lm.lora",
    processRunner
  });
  try {
    const failed = await createTrainer(async () => ({ code: 1, output: "backend exploded" })).start({
      workspace: workspace(), name: "Failed", objective: "Fail", examples
    });
    await assert.rejects(failed.completion, /training failed/);
    const missing = await createTrainer(async () => ({ code: 0, output: "done" })).start({
      workspace: workspace(), name: "Missing", objective: "Missing", examples
    });
    await assert.rejects(missing.completion, /without creating adapter weights/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function randomName() {
  return Math.random().toString(16).slice(2);
}
