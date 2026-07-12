export const MODEL_CATALOG = [
  {
    id: "zai-org/glm-5.2",
    name: "GLM-5.2",
    publisher: "Z.ai",
    sourceUrl: "https://huggingface.co/zai-org/GLM-5.2",
    revision: "f6142f127a14b58dc602592e996cd7d8ff139351",
    kind: "open-weight",
    license: "MIT",
    modality: "text",
    summary:
      "A frontier-scale open-weight model intended for complex reasoning, coding, and long-horizon agent work.",
    supportedAdaptations: ["lora"],
    supportedRuntimes: ["mock", "ollama"],
    developmentModelId: "qwen3:0.6b",
    status: "supported"
  }
];

export function getModel(modelId) {
  return MODEL_CATALOG.find((model) => model.id === modelId) ?? null;
}
