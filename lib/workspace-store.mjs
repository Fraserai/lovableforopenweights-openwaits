import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const DATA_FILE = path.resolve(process.env.OPENWEIGHT_DATA_FILE || "data/workspaces.json");
const DATA_DIR = path.dirname(DATA_FILE);

async function readAll() {
  try {
    const raw = await readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function writeAll(workspaces) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(DATA_FILE, JSON.stringify(workspaces, null, 2));
}

export async function listWorkspaces() {
  return readAll();
}

export async function getWorkspace(id) {
  const workspaces = await readAll();
  return workspaces.find((workspace) => workspace.id === id) ?? null;
}

export async function createWorkspace({ model, name }) {
  const now = new Date().toISOString();
  const workspace = {
    id: randomUUID(),
    name,
    phase: "forked",
    baseModel: {
      id: model.id,
      name: model.name,
      revision: model.revision,
      sourceUrl: model.sourceUrl,
      license: model.license
    },
    lineage: {
      parentModelId: model.id,
      parentRevision: model.revision,
      forkedAt: now
    },
    adaptation: null,
    run: null,
    createdAt: now,
    updatedAt: now
  };

  const workspaces = await readAll();
  workspaces.push(workspace);
  await writeAll(workspaces);
  return workspace;
}

export async function updateWorkspace(id, updater) {
  const workspaces = await readAll();
  const index = workspaces.findIndex((workspace) => workspace.id === id);
  if (index === -1) return null;

  const updated = {
    ...updater(structuredClone(workspaces[index])),
    updatedAt: new Date().toISOString()
  };
  workspaces[index] = updated;
  await writeAll(workspaces);
  return updated;
}

export async function clearWorkspaces() {
  await writeAll([]);
}
