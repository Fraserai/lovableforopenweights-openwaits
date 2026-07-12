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
import { MockComputeProvider } from "./lib/compute/mock-provider.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const compute = new MockComputeProvider();
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

async function handleApi(request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/health") {
    return sendJson(response, 200, { status: "ok", computeProvider: compute.name });
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

    const workspace = await updateWorkspace(params.id, (workspace) => ({
      ...workspace,
      phase: "adapted",
      adaptation: {
        id: randomId(),
        name,
        method: "lora",
        objective,
        datasetStatus: "not-connected",
        status: "specification-created",
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

    try {
      const run = await compute.start({ workspace: current, modelState });
      const workspace = await updateWorkspace(params.id, (workspace) => ({
        ...workspace,
        phase: "running",
        run
      }));
      return sendJson(response, 200, { workspace });
    } catch (error) {
      await updateWorkspace(params.id, (workspace) => ({
        ...workspace,
        phase: workspace.adaptation ? "adapted" : "forked",
        run: {
          provider: compute.name,
          executionMode: compute.executionMode || "unknown",
          status: "failed",
          error: error.message || "Compute failed to start",
          failedAt: new Date().toISOString()
        }
      }));
      return sendJson(response, 503, { error: error.message || "Compute failed to start" });
    }
  }

  params = routeMatch(url.pathname, /^\/api\/workspaces\/(?<id>[^/]+)\/chat$/);
  if (request.method === "POST" && params) {
    const workspace = await getWorkspace(params.id);
    if (!workspace) return sendJson(response, 404, { error: "Workspace not found" });
    if (workspace.run?.status !== "running") {
      return sendJson(response, 409, { error: "Run the workspace before chatting" });
    }
    const body = await readJson(request);
    const message = String(body.message || "").trim().slice(0, 4000);
    if (!message) return sendJson(response, 400, { error: "Message is required" });
    return sendJson(response, 200, {
      message: await compute.chat({ workspace, message })
    });
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
