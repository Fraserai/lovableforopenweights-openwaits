import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const MIN_EXAMPLES = 5;
export const MAX_EXAMPLES = 20;

export function validateExamples(input) {
  if (!Array.isArray(input)) {
    throw new TypeError("Examples must be a list");
  }
  if (input.length < MIN_EXAMPLES || input.length > MAX_EXAMPLES) {
    throw new TypeError(`Provide between ${MIN_EXAMPLES} and ${MAX_EXAMPLES} examples`);
  }

  return input.map((example, index) => {
    const user = String(example?.user || "").trim();
    const assistant = String(example?.assistant || "").trim();
    if (!user || !assistant) {
      throw new TypeError(`Example ${index + 1} needs both a user message and an ideal response`);
    }
    if (user.length > 4_000 || assistant.length > 8_000) {
      throw new TypeError(`Example ${index + 1} is too long`);
    }
    return { user, assistant };
  });
}

function toChatRecord(example) {
  return {
    messages: [
      { role: "user", content: example.user },
      { role: "assistant", content: example.assistant }
    ]
  };
}

export async function prepareExamples(input, datasetPath) {
  const examples = validateExamples(input);
  const validation = examples.at(-1);
  const training = examples.slice(0, -1);
  await mkdir(datasetPath, { recursive: true });
  const serialize = (records) => `${records.map((item) => JSON.stringify(toChatRecord(item))).join("\n")}\n`;
  await Promise.all([
    writeFile(path.join(datasetPath, "train.jsonl"), serialize(training)),
    writeFile(path.join(datasetPath, "valid.jsonl"), serialize([validation]))
  ]);
  return {
    examples,
    trainingCount: training.length,
    validationCount: 1,
    datasetPath
  };
}
