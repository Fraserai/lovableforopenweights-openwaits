import { randomUUID } from "node:crypto";

export class MockComputeProvider {
  name = "mock";

  async start({ workspace }) {
    return {
      id: randomUUID(),
      provider: this.name,
      status: "running",
      startedAt: new Date().toISOString(),
      endpoint: `/api/workspaces/${workspace.id}/chat`,
      hardware: "simulated GPU",
      note: "Development mode: no model weights or GPU have been allocated."
    };
  }

  async chat({ workspace, message }) {
    const adaptation = workspace.adaptation
      ? ` I am using the '${workspace.adaptation.name}' adaptation specification.`
      : " I am using the unadapted fork specification.";

    return {
      id: randomUUID(),
      role: "assistant",
      content:
        `Mock GLM-5.2 response: I received “${message}”.${adaptation} ` +
        "Replace MockComputeProvider with a real inference adapter to generate model output.",
      createdAt: new Date().toISOString()
    };
  }
}
