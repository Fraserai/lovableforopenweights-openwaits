import { randomUUID } from "node:crypto";
import path from "node:path";
import { prepareTogetherDataset } from "../adaptation/together-dataset.mjs";

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class TogetherProviderError extends Error {
  constructor(message, { status = 503, cause } = {}) {
    super(message, { cause });
    this.name = "TogetherProviderError";
    this.status = status;
  }
}

export function mapFineTuneStatus(status) {
  return {
    pending: "queued",
    queued: "queued",
    running: "training",
    compressing: "publishing",
    uploading: "publishing",
    completed: "complete",
    error: "failed",
    cancel_requested: "cancelled",
    cancelled: "cancelled"
  }[status] || "failed";
}

function providerError(error, action) {
  const message = error?.error?.message || error?.message || String(error);
  return new TogetherProviderError(`Together ${action} failed: ${message}`, {
    status: error?.status === 400 ? 400 : 503,
    cause: error
  });
}

export class TogetherManagedProvider {
  name = "together";
  displayName = "Together AI";
  executionMode = "real";
  realExecution = true;
  supportsAdaptedState = true;
  supportsRealFineTuning = true;
  hardware = "Managed cloud compute";

  constructor({
    apiKey,
    modelId,
    artifactsRoot = path.resolve("data/artifacts"),
    client,
    pollIntervalMs = 2_000,
    fileTimeoutMs = 120_000,
    endpointTimeoutMs = 15 * 60_000
  } = {}) {
    if (!String(apiKey || "").trim()) throw new TypeError("TOGETHER_API_KEY is required");
    if (!String(modelId || "").trim()) throw new TypeError("Together model ID is required");
    this.modelId = modelId;
    this.actualModelId = modelId;
    this.artifactsRoot = path.resolve(artifactsRoot);
    this.pollIntervalMs = pollIntervalMs;
    this.fileTimeoutMs = fileTimeoutMs;
    this.endpointTimeoutMs = endpointTimeoutMs;
    this.apiKey = apiKey;
    this.client = client || null;
  }

  async getClient() {
    if (!this.client) {
      const { default: Together } = await import("together-ai");
      this.client = new Together({ apiKey: this.apiKey });
    }
    return this.client;
  }

  runtimeDescription() {
    return {
      provider: this.name,
      providerDisplayName: this.displayName,
      executionMode: this.executionMode,
      realExecution: true,
      actualModelId: this.actualModelId,
      supportsAdaptedState: true,
      supportsRealFineTuning: true,
      backendEndpoint: "Together managed cloud",
      hardware: this.hardware
    };
  }

  async preflightModel(modelId = this.modelId, { requireFineTunable = true } = {}) {
    try {
      const client = await this.getClient();
      const [hardware, serverless, models] = await Promise.all([
        client.endpoints.listHardware({ model: modelId }),
        client.endpoints.list({ type: "serverless" }),
        client.models.list()
      ]);
      const providerModel = (models || []).find((model) => model.id === modelId);
      if (requireFineTunable && (!providerModel || providerModel.pricing?.finetune === undefined)) {
        throw new TogetherProviderError(`${modelId} is not listed for Together fine-tuning`, {
          status: 409
        });
      }
      const compatibleHardware = (hardware.data || []).filter((item) =>
        !item.availability || item.availability.status !== "insufficient"
      );
      if (compatibleHardware.length === 0) {
        throw new TogetherProviderError(
          `${modelId} has no compatible Together dedicated endpoint hardware`,
          { status: 409 }
        );
      }
      return {
        deployable: true,
        serverless: (serverless.data || []).some((endpoint) =>
          endpoint.model === modelId || endpoint.name === modelId
        ),
        providerModel,
        hardware: compatibleHardware
      };
    } catch (error) {
      if (error instanceof TogetherProviderError) throw error;
      throw providerError(error, "model preflight");
    }
  }

  async prepareFineTune({ workspace, name, objective, examples }) {
    if (workspace.baseModel.providerModelId !== this.modelId) {
      throw new TogetherProviderError("Workspace lineage does not match the Together model", {
        status: 409
      });
    }
    const id = randomUUID();
    const datasetPath = path.join(this.artifactsRoot, workspace.id, id, "training.jsonl");
    const prepared = await prepareTogetherDataset(examples, datasetPath);
    const now = new Date().toISOString();
    return {
      id,
      name,
      objective,
      method: "lora",
      examples: prepared.examples,
      exampleCount: prepared.exampleCount,
      status: "preparing",
      provider: this.name,
      providerModelId: this.modelId,
      sourceModelId: workspace.baseModel.sourceModelId,
      baseRevision: workspace.baseModel.revision,
      datasetPath,
      providerFileId: null,
      fineTuneJobId: null,
      outputModelId: null,
      configuration: {
        trainingMethod: "sft",
        trainingType: "lora",
        epochs: 1,
        loraRank: 8,
        loraAlpha: 8
      },
      createdAt: now,
      startedAt: null,
      completedAt: null,
      error: null
    };
  }

  async uploadTrainingFile(datasetPath) {
    try {
      const client = await this.getClient();
      const uploaded = await client.files.upload(datasetPath, "fine-tune", true);
      const deadline = Date.now() + this.fileTimeoutMs;
      let file = uploaded;
      while (!file.Processed && Date.now() < deadline) {
        await wait(this.pollIntervalMs);
        file = await client.files.retrieve(uploaded.id);
      }
      if (!file.Processed) {
        throw new TogetherProviderError(
          `Together did not validate training file ${uploaded.id} within ${this.fileTimeoutMs}ms`
        );
      }
      return file;
    } catch (error) {
      if (error instanceof TogetherProviderError) throw error;
      throw providerError(error, "training-file validation or upload");
    }
  }

  async createFineTune({ fileId, workspace, adaptation }) {
    try {
      const client = await this.getClient();
      return await client.fineTuning.create({
        model: workspace.baseModel.providerModelId,
        training_file: fileId,
        suffix: `openweight-${workspace.id.slice(0, 8)}`,
        n_epochs: 1,
        n_checkpoints: 1,
        training_method: { method: "sft", train_on_inputs: false },
        training_type: {
          type: "Lora",
          lora_r: adaptation.configuration.loraRank,
          lora_alpha: adaptation.configuration.loraAlpha,
          lora_dropout: 0,
          lora_trainable_modules: "all-linear"
        }
      });
    } catch (error) {
      throw providerError(error, "fine-tuning job creation");
    }
  }

  async getFineTune(jobId) {
    try {
      const client = await this.getClient();
      const job = await client.fineTuning.retrieve(jobId);
      const status = mapFineTuneStatus(job.status);
      return {
        status,
        providerStatus: job.status,
        outputModelId: job.model_output_name || null,
        progress: job.progress || null,
        startedAt: job.started_at || null,
        completedAt: status === "complete" ? job.updated_at || new Date().toISOString() : null,
        error: status === "failed"
          ? job.events?.findLast?.((event) => event.type === "job_error")?.message ||
            "Together fine-tuning failed"
          : null
      };
    } catch (error) {
      throw providerError(error, "fine-tuning status check");
    }
  }

  selectHardware(hardware) {
    const compatible = hardware.filter((item) => item.availability?.status === "available");
    if (compatible.length === 0) {
      throw new TogetherProviderError("No compatible Together endpoint hardware is currently available");
    }
    return [...compatible].sort((a, b) =>
      a.pricing.cents_per_minute - b.pricing.cents_per_minute ||
      a.specs.gpu_count - b.specs.gpu_count
    )[0];
  }

  async start({ workspace, modelState, runId, onEndpointCreated }) {
    const id = runId || randomUUID();
    if (modelState === "base") {
      const preflight = await this.preflightModel(workspace.baseModel.providerModelId);
      if (preflight.serverless) {
        const now = new Date().toISOString();
        return this.buildRun({
          id, workspace, modelState, modelId: workspace.baseModel.providerModelId,
          endpoint: null, hardware: "Together serverless", startedAt: now
        });
      }
      return this.startDedicated({
        id, workspace, modelState, modelId: workspace.baseModel.providerModelId,
        hardware: this.selectHardware(preflight.hardware), onEndpointCreated
      });
    }

    const adaptation = workspace.fineTune || workspace.adaptation;
    if (adaptation?.status !== "complete" || !adaptation.outputModelId) {
      throw new TogetherProviderError(
        "The fine-tuned state is unavailable until Together publishes an output model",
        { status: 409 }
      );
    }
    const preflight = await this.preflightModel(adaptation.outputModelId, { requireFineTunable: false });
    return this.startDedicated({
      id, workspace, modelState, modelId: adaptation.outputModelId,
      hardware: this.selectHardware(preflight.hardware), onEndpointCreated
    });
  }

  async startDedicated({ id, workspace, modelState, modelId, hardware, onEndpointCreated }) {
    let endpoint;
    try {
      const client = await this.getClient();
      endpoint = await client.endpoints.create({
        model: modelId,
        hardware: hardware.id,
        autoscaling: { min_replicas: 1, max_replicas: 1 },
        display_name: `OpenWeight ${workspace.id.slice(0, 8)}`,
        inactive_timeout: 15
      });
      await onEndpointCreated?.({
        endpointId: endpoint.id,
        endpointModelName: endpoint.name,
        endpointState: endpoint.state,
        actualModelId: endpoint.model,
        hardware: hardware.id
      });
      const deadline = Date.now() + this.endpointTimeoutMs;
      while (endpoint.state !== "STARTED" && Date.now() < deadline) {
        if (endpoint.state === "ERROR") {
          throw new TogetherProviderError(`Together endpoint ${endpoint.id} failed to start`);
        }
        await wait(this.pollIntervalMs);
        endpoint = await client.endpoints.retrieve(endpoint.id);
      }
      if (endpoint.state !== "STARTED") {
        throw new TogetherProviderError(`Together endpoint ${endpoint.id} did not become ready`);
      }
      return this.buildRun({
        id, workspace, modelState, modelId, endpoint, hardware: hardware.id,
        startedAt: new Date().toISOString()
      });
    } catch (error) {
      if (endpoint?.id) {
        const client = await this.getClient();
        await client.endpoints.delete(endpoint.id).catch(() => {});
      }
      if (error instanceof TogetherProviderError) throw error;
      throw providerError(error, "endpoint start");
    }
  }

  buildRun({ id, workspace, modelState, modelId, endpoint, hardware, startedAt }) {
    const fineTune = workspace.fineTune || workspace.adaptation;
    return {
      id,
      provider: this.name,
      providerDisplayName: this.displayName,
      executionMode: this.executionMode,
      realExecution: true,
      status: "running",
      requestedModelId: workspace.baseModel.id,
      actualModelId: modelId,
      baseModelId: workspace.baseModel.providerModelId,
      baseRevision: workspace.baseModel.revision,
      modelState: modelState === "fine-tuned" || modelState === "adapted"
        ? { kind: "fine-tuned", label: fineTune.name, fineTuneId: fineTune.id }
        : { kind: "base", label: `${workspace.baseModel.name} base`, fineTuneId: null },
      fineTuneJobId: modelState === "base" ? null : fineTune.fineTuneJobId,
      endpointId: endpoint?.id || null,
      endpointModelName: endpoint?.name || modelId,
      endpointType: endpoint ? "dedicated" : "serverless",
      endpointState: endpoint?.state || "STARTED",
      endpoint: `/api/workspaces/${workspace.id}/chat`,
      backendEndpoint: "Together managed cloud",
      hardware,
      conversation: [],
      startingAt: workspace.run?.startingAt || startedAt,
      startedAt,
      checkedAt: startedAt,
      error: null
    };
  }

  async getStatus({ workspace }) {
    const run = workspace.run;
    if (!run.endpointId) {
      return { status: "running", endpointState: "STARTED", checkedAt: new Date().toISOString() };
    }
    try {
      const client = await this.getClient();
      const endpoint = await client.endpoints.retrieve(run.endpointId);
      const status = endpoint.state === "STARTED"
        ? "running"
        : ["PENDING", "STARTING"].includes(endpoint.state)
          ? "starting"
          : ["STOPPING", "STOPPED"].includes(endpoint.state) ? "stopped" : "failed";
      return {
        status,
        endpointState: endpoint.state,
        endpointModelName: endpoint.name,
        actualModelId: endpoint.model,
        checkedAt: new Date().toISOString()
      };
    } catch (error) {
      throw providerError(error, "endpoint health check");
    }
  }

  async chat({ workspace, messages }) {
    const model = workspace.run.endpointModelName;
    try {
      const client = await this.getClient();
      const response = await client.chat.completions.create({
        model,
        messages: messages.map(({ role, content }) => ({ role, content })),
        max_tokens: 512,
        temperature: 0.2
      });
      const content = String(response.choices?.[0]?.message?.content || "").trim();
      if (!content) throw new TogetherProviderError("Together returned no assistant content");
      return {
        id: response.id || randomUUID(),
        role: "assistant",
        content,
        provider: this.name,
        providerDisplayName: this.displayName,
        executionMode: this.executionMode,
        realExecution: true,
        requestedModelId: workspace.baseModel.id,
        actualModelId: workspace.run.actualModelId,
        baseModelId: workspace.baseModel.providerModelId,
        baseRevision: workspace.baseModel.revision,
        fineTuneJobId: workspace.run.fineTuneJobId,
        endpointId: workspace.run.endpointId,
        endpointModelName: model,
        modelState: workspace.run.modelState,
        createdAt: new Date().toISOString(),
        metrics: {
          promptTokens: response.usage?.prompt_tokens ?? null,
          completionTokens: response.usage?.completion_tokens ?? null
        }
      };
    } catch (error) {
      if (error instanceof TogetherProviderError) throw error;
      throw providerError(error, "chat request");
    }
  }

  async stop({ workspace }) {
    if (workspace.run.endpointId) {
      try {
        const client = await this.getClient();
        await client.endpoints.delete(workspace.run.endpointId);
      } catch (error) {
        throw providerError(error, "endpoint deletion");
      }
    }
    return {
      ...workspace.run,
      status: "stopped",
      endpointState: "DELETED",
      stoppedAt: new Date().toISOString(),
      checkedAt: new Date().toISOString()
    };
  }
}
