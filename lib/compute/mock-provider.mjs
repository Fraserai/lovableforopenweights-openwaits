import { randomUUID } from "node:crypto";

export class MockComputeProvider {
  name = "mock";
  executionMode = "simulation";

  /**
   * @param {{ workspace: object, modelState: "base" | "adapted" }} options
   */
  async start({ workspace, modelState }) {
    const activeState = modelState === "adapted"
      ? {
          kind: "adapted",
          label: workspace.adaptation.name,
          adaptationId: workspace.adaptation.id
        }
      : {
          kind: "base",
          label: `${workspace.baseModel.name} base`,
          adaptationId: null
        };

    return {
      id: randomUUID(),
      provider: this.name,
      executionMode: this.executionMode,
      status: "running",
      modelState: activeState,
      startedAt: new Date().toISOString(),
      endpoint: `/api/workspaces/${workspace.id}/chat`,
      hardware: "simulated GPU",
      note: "Simulation only: no model weights, adaptation training, or GPU inference have run."
    };
  }

  /**
   * @param {{ workspace: object, message: string }} options
   */
  async chat({ workspace, message }) {
    const activeState = workspace.run.modelState;
    const stateDescription = activeState.kind === "adapted"
      ? `the '${activeState.label}' adaptation specification`
      : "the immutable base specification";

    return {
      id: randomUUID(),
      role: "assistant",
      executionMode: this.executionMode,
      modelState: activeState,
      content:
        `Simulated response for ${stateDescription}: I received "${message}". ` +
        "No GLM-5.2 inference was performed.",
      createdAt: new Date().toISOString()
    };
  }
}
