import http from "node:http";

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}

export async function startFakeOllama({
  model = "qwen3:0.6b",
  healthyAfterPs = 0,
  failChat = false
} = {}) {
  const state = {
    model,
    loaded: false,
    loadRequested: false,
    psCalls: 0,
    chatCalls: 0,
    stopCalls: 0,
    lastChatBody: null
  };

  const server = http.createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/api/version") {
      return sendJson(response, 200, { version: "test-1.0.0" });
    }

    if (request.method === "POST" && request.url === "/api/show") {
      const body = await readJson(request);
      if (body.model !== model) return sendJson(response, 404, { error: "model not found" });
      return sendJson(response, 200, {
        details: { family: "qwen3", parameter_size: "0.6B", quantization_level: "Q4_K_M" }
      });
    }

    if (request.method === "POST" && request.url === "/api/generate") {
      const body = await readJson(request);
      if (body.keep_alive === 0) {
        state.loaded = false;
        state.loadRequested = false;
        state.stopCalls += 1;
      } else {
        state.loadRequested = true;
      }
      return sendJson(response, 200, { model, done: true, response: "" });
    }

    if (request.method === "GET" && request.url === "/api/ps") {
      state.psCalls += 1;
      if (state.loadRequested && state.psCalls > healthyAfterPs) state.loaded = true;
      return sendJson(response, 200, {
        models: state.loaded
          ? [{ name: model, model, digest: "sha256:test-model", size_vram: 512_000_000 }]
          : []
      });
    }

    if (request.method === "POST" && request.url === "/api/chat") {
      state.chatCalls += 1;
      state.lastChatBody = await readJson(request);
      if (failChat) return sendJson(response, 500, { error: "backend generation failed" });
      if (!state.loaded) return sendJson(response, 409, { error: "model is not loaded" });
      return sendJson(response, 200, {
        model,
        created_at: "2026-07-12T00:00:00.000Z",
        message: { role: "assistant", content: "Backend-generated development response." },
        done: true,
        total_duration: 123,
        prompt_eval_count: 8,
        eval_count: 4
      });
    }

    return sendJson(response, 404, { error: "not found" });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    state,
    async stop() {
      await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  };
}
