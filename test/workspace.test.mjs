import test from "node:test";
import assert from "node:assert/strict";
import { getModel } from "../lib/model-catalog.mjs";
import {
  clearWorkspaces,
  createWorkspace,
  getWorkspace,
  updateWorkspace
} from "../lib/workspace-store.mjs";
import { MockComputeProvider } from "../lib/compute/mock-provider.mjs";

test.beforeEach(async () => {
  await clearWorkspaces();
});

test("Choose → Fork → Adapt → Run preserves model lineage", async () => {
  const model = getModel("zai-org/glm-5.2");
  assert.ok(model);

  const fork = await createWorkspace({ model, name: "Research GLM" });
  assert.equal(fork.phase, "forked");
  assert.equal(fork.lineage.parentModelId, model.id);

  const adapted = await updateWorkspace(fork.id, (workspace) => ({
    ...workspace,
    phase: "adapted",
    adaptation: {
      id: "adaptation-test",
      name: "Research specialist",
      method: "lora",
      objective: "Improve open-weight research assistance"
    }
  }));
  assert.equal(adapted.phase, "adapted");
  assert.equal(adapted.baseModel.id, model.id);

  const provider = new MockComputeProvider();
  const run = await provider.start({ workspace: adapted });
  const running = await updateWorkspace(fork.id, (workspace) => ({
    ...workspace,
    phase: "running",
    run
  }));

  assert.equal(running.run.status, "running");
  assert.match(running.run.endpoint, new RegExp(fork.id));
  assert.equal((await getWorkspace(fork.id)).baseModel.id, model.id);
});
