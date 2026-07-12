import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MODEL_CATALOG, getModel } from "./lib/model-catalog.mjs";
import {
  createWorkspace,
  getWorkspace,
  listWorkspaces,
  updateWorkspace
} from "./lib/workspace-store.mjs";
import { createComputeProvider } from "./lib/compute/index.mjs";
import { MlxAdaptationTrainer } from "./lib/adaptation/mlx-trainer.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const compute = createComputeProvider();
const adaptationTrainer = compute.name === "mlx"
  ? new MlxAdaptationTrainer({
      modelPath: process.env.MLX_MODEL_PATH,
      modelId: MODEL_CATALOG[0].id,
      modelRevision: MODEL_CATALOG[0].revision,
      artifactsRoot: process.env.MLX_ARTIFACTS_PATH || path.resolve("data/artifacts"),
      loraCommand: process.env.MLX_LORA_COMMAND,
      iterations: Number(process.env.MLX_TRAIN_ITERS || 20),
      numLayers: Number(process.env.MLX_TRAIN_LAYERS || 4),
      learningRate: Number(process.env.MLX_TRAIN_LEARNING_RATE || 1e-4)
    })
  : null;
const port = Number(process.env.PORT || 3000);

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function sendJson(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("Invalid JSON body");
    error.status = 400;
    throw error;
  }
}

function routeMatch(pathname, pattern) {
  const match = pathname.match(pattern);
  return match ? match.groups ?? {} : null;
}

function inactivePhase(workspace) {
  return workspace.adaptation ? "adapted" : "forked";
}

function selectedModelState(workspace, kind) {
  if (kind === "adapted") {
    return {
      kind,
      label: workspace.adaptation.name,
      adaptationId: workspace.adaptation.id
    };
  }
  return {
    kind: "base",
    label: `${workspace.baseModel.name} base`,
    adaptationId: null
  };
}

function runtimeDescription() {
  return {
    provider: compute.name,
    providerDisplayName: compute.displayName,
    executionMode: compute.executionMode,
    realExecution: compute.realExecution,
    actualModelId: compute.actualModelId,
    supportsAdaptedState: compute.supportsAdaptedState,
    supportsRealAdaptation: Boolean(adaptationTrainer),
    backendEndpoint: compute.baseUrl || null,
    hardware: compute.hardware
  };
}

async function handleApi(request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/health") {
    return sendJson(response, 200, {
      status: "ok",
      computeProvider: compute.name,
      runtime: runtimeDescription()
    });
  }

  if (request.method === "GET" && url.pathname === "/api/models") {
    return sendJson(response, 200, { models: MODEL_CATALOG });
  }

  if (request.method === "GET" && url.pathname === "/api/workspaces") {
    return sendJson(response, 200, { workspaces: await listWorkspaces() });
  }

  if (request.method === "POST" && url.pathname === "/api/workspaces") {
    const body = await readJson(request);
    const model = getModel(body.modelId);
    if (!model) return sendJson(response, 404, { error: "Model is not supported" });
    const name = String(body.name || `My ${model.name}`).trim().slice(0, 80);
    const workspace = await createWorkspace({ model, name });
    return sendJson(response, 201, { workspace });
  }

  let params = routeMatch(url.pathname, /^\/api\/workspaces\/(?<id>[^/]+)$/);
  if (request.method === "GET" && params) {
    const workspace = await getWorkspace(params.id);
    if (!workspace) return sendJson(response, 404, { error: "Workspace not found" });
    return sendJson(response, 200, { workspace });
  }

  params = routeMatch(url.pathname, /^\/api\/workspaces\/(?<id>[^/]+)\/adapt$/);
  if (request.method === "POST" && params) {
    const body = await readJson(request);
    const current = await getWorkspace(params.id);
    if (!current) return sendJson(response, 404, { error: "Workspace not found" });

    const name = String(body.name || "My adaptation").trim().slice(0, 80);
    const objective = String(body.objective || "").trim().slice(0, 1000);
    if (!objective) return sendJson(response, 400, { error: "Adaptation objective is required" });

    if (adaptationTrainer) {
      let training;
      try {
        training = await adaptationTrainer.start({
          workspace: current,
          name,
          objective,
          examples: body.examples
        });
      } catch (error) {
        return sendJson(response, error.status || 400, { error: error.message });
      }
      const workspace = await updateWorkspace(params.id, (workspace) => ({
        ...workspace,
        phase: "adapting",
        adaptation: training.adaptation,
        run: null
      }));
      training.completion.then(
        (completed) => updateWorkspace(params.id, (latest) => ({
          ...latest,
          phase: "adapted",
          adaptation: completed
        })),
        (error) => updateWorkspace(params.id, (latest) => ({
          ...latest,
          phase: "adaptation-failed",
          adaptation: {
            ...latest.adaptation,
            status: "failed",
            completedAt: new Date().toISOString(),
            error: error.message || "MLX-LM training failed",
            logs: String(error.logs || "").slice(-16_000)
          }
        }))
      );
      return sendJson(response, 202, { workspace });
    }

    const workspace = await updateWorkspace(params.id, (workspace) => ({
      ...workspace,
      phase: "adapted",
      adaptation: {
        id: randomId(),
        name,
        method: "lora",
        objective,
        examples: Array.isArray(body.examples) ? body.examples : [],
        exampleCount: Array.isArray(body.examples) ? body.examples.length : 0,
        status: "specification-created",
        trainingBackend: null,
        createdAt: new Date().toISOString()
      },
      run: null
    }));
    return sendJson(response, 200, { workspace });
  }

  params = routeMatch(url.pathname, /^\/api\/workspaces\/(?<id>[^/]+)\/run$/);
  if (request.method === "POST" && params) {
    const body = await readJson(request);
    const current = await getWorkspace(params.id);
    if (!current) return sendJson(response, 404, { error: "Workspace not found" });
    const modelState = body.modelState || "base";
    if (!["base", "adapted"].includes(modelState)) {
      return sendJson(response, 400, { error: "Model state must be base or adapted" });
    }
    if (modelState === "adapted" && !current.adaptation) {
      return sendJson(response, 409, { error: "Create an adaptation before running the adapted state" });
    }
    if (modelState === "adapted" && compute.realExecution && current.adaptation.status !== "complete") {
      return sendJson(response, 409, {
        error: "Real adaptation training must complete before starting the adapted state"
      });
    }
    if (modelState === "adapted" && !compute.supportsAdaptedState) {
      return sendJson(response, 409, {
        error: `${compute.displayName} cannot run the adapted state because no trained adapter exists`
      });
    }

    const startingAt = new Date().toISOString();
    const startingRun = {
      id: randomId(),
      ...runtimeDescription(),
      status: "starting",
      requestedModelId: current.baseModel.id,
      modelState: selectedModelState(current, modelState),
      endpoint: `/api/workspaces/${current.id}/chat`,
      startingAt,
      startedAt: null,
      error: null
    };
    const startingWorkspace = await updateWorkspace(params.id, (workspace) => ({
      ...workspace,
      phase: "starting",
      run: startingRun
    }));

    try {
      const run = await compute.start({
        workspace: startingWorkspace,
        modelState,
        runId: startingRun.id
      });
      const workspace = await updateWorkspace(params.id, (workspace) => ({
        ...workspace,
        phase: "running",
        run
      }));
      return sendJson(response, 200, { workspace });
    } catch (error) {
      await updateWorkspace(params.id, (workspace) => ({
        ...workspace,
        phase: inactivePhase(workspace),
        run: {
          ...startingRun,
          status: "failed",
          error: error.message || "Compute failed to start",
          failedAt: new Date().toISOString()
        }
      }));
      return sendJson(response, error.status || 503, {
        error: error.message || "Compute failed to start"
      });
    }
  }

  params = routeMatch(url.pathname, /^\/api\/workspaces\/(?<id>[^/]+)\/run\/status$/);
  if (request.method === "GET" && params) {
    const current = await getWorkspace(params.id);
    if (!current) return sendJson(response, 404, { error: "Workspace not found" });
    if (!current.run) return sendJson(response, 200, { workspace: current });
    if (current.run.provider !== compute.name) {
      const workspace = await updateWorkspace(params.id, (workspace) => ({
        ...workspace,
        phase: inactivePhase(workspace),
        run: {
          ...workspace.run,
          status: "failed",
          error:
            `Persisted run uses ${workspace.run.provider}, but the configured provider is ${compute.name}`,
          failedAt: new Date().toISOString()
        }
      }));
      return sendJson(response, 200, { workspace });
    }
    if (current.run.status === "stopped") {
      return sendJson(response, 200, { workspace: current });
    }

    try {
      const status = await compute.getStatus({ workspace: current });
      const workspace = await updateWorkspace(params.id, (workspace) => ({
        ...workspace,
        phase: status.status === "running" ? "running" : inactivePhase(workspace),
        run: { ...workspace.run, ...status, error: null }
      }));
      return sendJson(response, 200, { workspace });
    } catch (error) {
      const workspace = await updateWorkspace(params.id, (workspace) => ({
        ...workspace,
        phase: inactivePhase(workspace),
        run: {
          ...workspace.run,
          status: "failed",
          error: error.message || "Runtime health check failed",
          failedAt: new Date().toISOString()
        }
      }));
      return sendJson(response, 200, { workspace });
    }
  }

  params = routeMatch(url.pathname, /^\/api\/workspaces\/(?<id>[^/]+)\/stop$/);
  if (request.method === "POST" && params) {
    const current = await getWorkspace(params.id);
    if (!current) return sendJson(response, 404, { error: "Workspace not found" });
    if (!current.run) return sendJson(response, 409, { error: "No runtime has been started" });
    if (current.run.provider !== compute.name) {
      return sendJson(response, 409, {
        error: `Cannot stop a ${current.run.provider} run with the ${compute.name} provider`
      });
    }

    try {
      const run = await compute.stop({ workspace: current });
      const workspace = await updateWorkspace(params.id, (workspace) => ({
        ...workspace,
        phase: inactivePhase(workspace),
        run
      }));
      return sendJson(response, 200, { workspace });
    } catch (error) {
      const workspace = await updateWorkspace(params.id, (workspace) => ({
        ...workspace,
        phase: inactivePhase(workspace),
        run: {
          ...workspace.run,
          status: "failed",
          error: error.message || "Runtime failed to stop",
          failedAt: new Date().toISOString()
        }
      }));
      return sendJson(response, error.status || 503, {
        error: error.message || "Runtime failed to stop",
        workspace
      });
    }
  }

  params = routeMatch(url.pathname, /^\/api\/workspaces\/(?<id>[^/]+)\/chat$/);
  if (request.method === "POST" && params) {
    const workspace = await getWorkspace(params.id);
    if (!workspace) return sendJson(response, 404, { error: "Workspace not found" });
    if (workspace.run?.status !== "running") {
      return sendJson(response, 409, { error: "Run the workspace before chatting" });
    }
    if (workspace.run.provider !== compute.name) {
      return sendJson(response, 409, {
        error: `Run uses ${workspace.run.provider}, but the configured provider is ${compute.name}`
      });
    }
    const body = await readJson(request);
    const message = String(body.message || "").trim().slice(0, 4000);
    if (!message) return sendJson(response, 400, { error: "Message is required" });
    try {
      return sendJson(response, 200, {
        message: await compute.chat({ workspace, message })
      });
    } catch (error) {
      await updateWorkspace(params.id, (current) => ({
        ...current,
        phase: inactivePhase(current),
        run: {
          ...current.run,
          status: "failed",
          error: error.message || "Runtime chat request failed",
          failedAt: new Date().toISOString()
        }
      }));
      return sendJson(response, error.status || 502, {
        error: error.message || "Runtime chat request failed"
      });
    }
  }

  return sendJson(response, 404, { error: "API route not found" });
}

function randomId() {
  return crypto.randomUUID();
}

async function serveStatic(response, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const safePath = path.normalize(requested).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(publicDir, safePath);
  if (!filePath.startsWith(publicDir)) {
    response.writeHead(403);
    return response.end("Forbidden");
  }

  try {
    const data = await readFile(filePath);
    response.writeHead(200, {
      "content-type": contentTypes[path.extname(filePath)] || "application/octet-stream"
    });
    response.end(data);
  } catch (error) {
    if (error?.code === "ENOENT") {
      const index = await readFile(path.join(publicDir, "index.html"));
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(index);
      return;
    }
    throw error;
  }
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
    } else {
      await serveStatic(response, url.pathname);
    }
  } catch (error) {
    console.error(error);
    sendJson(response, error.status || 500, { error: error.message || "Internal error" });
  }
});

server.listen(port, () => {
  const address = server.address();
  console.log(`OpenWeight MVP running at http://localhost:${address.port}`);
});
