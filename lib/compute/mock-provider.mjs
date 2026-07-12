import { randomUUID } from "node:crypto";

export class MockComputeProvider {
  name = "mock";
  displayName = "Mock compute";
  executionMode = "simulation";
  realExecution = false;
  supportsAdaptedState = true;
  actualModelId = null;
  hardware = "Simulated GPU";

  /**
   * @param {{ workspace: object, modelState: "base" | "adapted" }} options
   */
  async start({ workspace, modelState, runId }) {
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
      id: runId || randomUUID(),
      provider: this.name,
      providerDisplayName: this.displayName,
      executionMode: this.executionMode,
      realExecution: false,
      status: "running",
      requestedModelId: workspace.baseModel.id,
      actualModelId: null,
      developmentModel: false,
      modelState: activeState,
      startingAt: workspace.run?.startingAt || new Date().toISOString(),
      startedAt: new Date().toISOString(),
      endpoint: `/api/workspaces/${workspace.id}/chat`,
      backendEndpoint: null,
      hardware: this.hardware,
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
      provider: this.name,
      providerDisplayName: this.displayName,
      executionMode: this.executionMode,
      realExecution: false,
      requestedModelId: workspace.baseModel.id,
      actualModelId: null,
      modelState: activeState,
      content:
        `Simulated response for ${stateDescription}: I received "${message}". ` +
        "No GLM-5.2 inference was performed.",
      createdAt: new Date().toISOString()
    };
  }

  async getStatus({ workspace }) {
    return {
      provider: this.name,
      providerDisplayName: this.displayName,
      executionMode: this.executionMode,
      realExecution: false,
      actualModelId: null,
      status: workspace.run?.status === "running" ? "running" : "stopped",
      checkedAt: new Date().toISOString()
    };
  }

  async stop({ workspace }) {
    return {
      ...workspace.run,
      status: "stopped",
      checkedAt: new Date().toISOString(),
      stoppedAt: new Date().toISOString()
    };
  }
}
