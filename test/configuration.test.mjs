import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = path.dirname(fileURLToPath(new URL("../package.json", import.meta.url)));

function spawnServer(env) {
  return spawn(process.execPath, ["server.mjs"], {
    cwd: projectDir,
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });
}

test("normal startup fails clearly without managed cloud credentials", async () => {
  const env = { ...process.env, PORT: "0" };
  delete env.TOGETHER_API_KEY;
  delete env.COMPUTE_PROVIDER;
  delete env.APP_MODE;
  const child = spawnServer(env);
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const code = await new Promise((resolve) => child.once("exit", resolve));
  assert.notEqual(code, 0);
  assert.match(stderr, /TOGETHER_API_KEY is required/);
});

test("API health metadata never returns the Together server key", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "together-secret-"));
  const secret = "together-secret-never-return";
  const child = spawnServer({
    ...process.env,
    PORT: "0",
    TOGETHER_API_KEY: secret,
    OPENWEIGHT_DATA_FILE: path.join(dataDir, "workspaces.json")
  });
  try {
    const baseUrl = await new Promise((resolve, reject) => {
      let stderr = "";
      const timeout = setTimeout(() => reject(new Error(stderr || "server timeout")), 5_000);
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.stdout.on("data", (chunk) => {
        const match = chunk.toString().match(/http:\/\/localhost:(\d+)/);
        if (match) {
          clearTimeout(timeout);
          resolve(`http://localhost:${match[1]}`);
        }
      });
    });
    const response = await fetch(`${baseUrl}/api/health`);
    const raw = await response.text();
    assert.equal(response.status, 200);
    assert.equal(raw.includes(secret), false);
    assert.equal(JSON.parse(raw).runtime.provider, "together");
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
});
