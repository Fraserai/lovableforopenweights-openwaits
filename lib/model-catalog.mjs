export const MODEL_CATALOG = [
  {
    id: "Qwen/Qwen3-0.6B",
    name: "Qwen3 0.6B",
    publisher: "Qwen",
    sourceUrl: "https://huggingface.co/Qwen/Qwen3-0.6B",
    sourceModelId: "Qwen/Qwen3-0.6B",
    providerModelId: "Qwen/Qwen3-0.6B",
    provider: "together",
    revision: null,
    revisionStatus: "unavailable-from-provider",
    kind: "open-weight",
    license: "Apache-2.0",
    modality: "text",
    summary:
      "A compact Qwen model managed in the cloud for real fine-tuning and inference.",
    supportedAdaptations: ["lora"],
    supportedRuntimes: ["together"],
    parameterCount: "0.6B",
    status: "provider-preflight-required"
  }
];

export const TOGETHER_MODEL_CANDIDATES = [
  MODEL_CATALOG[0],
  cloudQwenModel("Qwen/Qwen3-1.7B", "Qwen3 1.7B", "1.7B"),
  cloudQwenModel("Qwen/Qwen3-4B", "Qwen3 4B", "4B")
];

function cloudQwenModel(id, name, parameterCount) {
  return {
    ...MODEL_CATALOG[0],
    id,
    name,
    sourceUrl: `https://huggingface.co/${id}`,
    sourceModelId: id,
    providerModelId: id,
    parameterCount,
    summary: `The smallest deployable Qwen fallback selected for managed cloud fine-tuning and inference.`
  };
}

export function getModel(modelId) {
  return MODEL_CATALOG.find((model) => model.id === modelId) ?? null;
}
