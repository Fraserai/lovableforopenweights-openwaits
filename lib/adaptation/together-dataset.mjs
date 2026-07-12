import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { validateExamples } from "./examples.mjs";

export async function prepareTogetherDataset(examplesInput, datasetPath) {
  const examples = validateExamples(examplesInput);
  await mkdir(path.dirname(datasetPath), { recursive: true });
  const records = examples.map((example) => ({
    messages: [
      { role: "user", content: example.user },
      { role: "assistant", content: example.assistant }
    ]
  }));
  await writeFile(datasetPath, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
  return { examples, exampleCount: examples.length, datasetPath };
}
