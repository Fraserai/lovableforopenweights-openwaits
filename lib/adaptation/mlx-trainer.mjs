import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { access, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { prepareExamples } from "./examples.mjs";

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal, output }));
  });
}

export class MlxAdaptationTrainer {
  name = "mlx-lm";

  constructor({
    modelPath,
    modelId,
    modelRevision,
    artifactsRoot = path.resolve("data/artifacts"),
    loraCommand,
    iterations = 20,
    numLayers = 4,
    learningRate = 1e-4,
    processRunner = runProcess
  } = {}) {
    if (!String(modelPath || "").trim()) throw new TypeError("MLX_MODEL_PATH is required");
    if (!String(loraCommand || "").trim()) throw new TypeError("MLX_LORA_COMMAND is required");
    if (!String(modelId || "").trim() || !String(modelRevision || "").trim()) {
      throw new TypeError("MLX model identity and revision are required");
    }
    if (!Number.isInteger(iterations) || iterations < 1) {
      throw new TypeError("MLX_TRAIN_ITERS must be a positive integer");
    }
    this.modelPath = path.resolve(modelPath);
    this.modelId = modelId;
    this.modelRevision = modelRevision;
    this.artifactsRoot = path.resolve(artifactsRoot);
    this.loraCommand = loraCommand;
    this.iterations = iterations;
    this.numLayers = numLayers;
    this.learningRate = learningRate;
    this.processRunner = processRunner;
  }

  async start({ workspace, name, objective, examples }) {
    if (workspace.baseModel.id !== this.modelId || workspace.baseModel.revision !== this.modelRevision) {
      throw new TypeError("Workspace lineage does not match the configured MLX base revision");
    }
    await access(this.modelPath);

    const id = randomUUID();
    const artifactRoot = path.join(this.artifactsRoot, workspace.id, id);
    const datasetPath = path.join(artifactRoot, "dataset");
    const adapterPath = path.join(artifactRoot, "adapter");
    await mkdir(adapterPath, { recursive: true });
    const prepared = await prepareExamples(examples, datasetPath);
    const startedAt = new Date().toISOString();
    const adaptation = {
      id,
      name,
      method: "lora",
      objective,
      examples: prepared.examples,
      exampleCount: prepared.examples.length,
      status: "training",
      trainingBackend: this.name,
      baseModelId: this.modelId,
      baseRevision: this.modelRevision,
      datasetPath,
      adapterPath,
      configuration: {
        iterations: this.iterations,
        numLayers: this.numLayers,
        learningRate: this.learningRate,
        batchSize: 1,
        maskPrompt: true
      },
      createdAt: startedAt,
      startedAt,
      completedAt: null,
      error: null,
      logs: ""
    };

    return {
      adaptation,
      completion: this.train(adaptation)
    };
  }

  async train(adaptation) {
    const began = Date.now();
    const result = await this.processRunner("/usr/bin/time", [
      "-l",
      this.loraCommand,
      "--model", this.modelPath,
      "--train",
      "--data", adaptation.datasetPath,
      "--fine-tune-type", "lora",
      "--mask-prompt",
      "--num-layers", String(this.numLayers),
      "--batch-size", "1",
      "--iters", String(this.iterations),
      "--val-batches", "1",
      "--learning-rate", String(this.learningRate),
      "--steps-per-report", "1",
      "--steps-per-eval", String(this.iterations),
      "--save-every", String(this.iterations),
      "--max-seq-length", "512",
      "--seed", "42",
      "--adapter-path", adaptation.adapterPath
    ], { cwd: path.dirname(this.modelPath) });

    const logs = String(result.output || "").slice(-16_000);
    if (result.code !== 0) {
      const error = new Error(`MLX-LM training failed${result.signal ? ` (${result.signal})` : ""}`);
      error.logs = logs;
      throw error;
    }

    const weightsPath = path.join(adaptation.adapterPath, "adapters.safetensors");
    try {
      await access(weightsPath);
    } catch {
      const error = new Error("MLX-LM exited without creating adapter weights");
      error.logs = logs;
      throw error;
    }
    const [weights, details] = await Promise.all([readFile(weightsPath), stat(weightsPath)]);
    const rssMatch = logs.match(/(\d+)\s+maximum resident set size/);
    return {
      ...adaptation,
      status: "complete",
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - began,
      adapterSizeBytes: details.size,
      adapterSha256: createHash("sha256").update(weights).digest("hex"),
      peakMemoryBytes: rssMatch ? Number(rssMatch[1]) : null,
      logs
    };
  }
}
