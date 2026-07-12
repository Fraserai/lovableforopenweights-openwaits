export const MODEL_CATALOG = [
  {
    id: "mlx-community/Qwen3-0.6B-4bit",
    name: "Qwen3 0.6B",
    publisher: "Qwen / MLX Community",
    sourceUrl:
      "https://huggingface.co/mlx-community/Qwen3-0.6B-4bit/tree/73e3e38d981303bc594367cd910ea6eb48349da8",
    revision: "73e3e38d981303bc594367cd910ea6eb48349da8",
    kind: "open-weight",
    license: "Apache-2.0",
    modality: "text",
    summary:
      "A compact, Apple Silicon-ready development model pinned for real local adaptation and inference.",
    supportedAdaptations: ["lora"],
    supportedRuntimes: ["mock", "mlx"],
    parameterCount: "0.6B",
    quantization: "4-bit",
    status: "supported"
  }
];

export function getModel(modelId) {
  return MODEL_CATALOG.find((model) => model.id === modelId) ?? null;
}
