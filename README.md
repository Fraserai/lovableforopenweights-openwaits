# OpenWeight MVP

**Cursor / Replit for Open-Weight AI.**

> **Choose → Fork → Fine-tune → Run**

OpenWeight lets a user choose one supported open-weight model, create an immutable lineage, fine-tune it from 5–20 example conversations, and chat with either the base or fine-tuned state. Together AI supplies the managed training and inference infrastructure; the browser never asks for provider credentials, hardware, model paths, Python, or local GPU setup.

## Run the managed MVP

Requirements: Node.js 20+ and a server-side Together API key.

```bash
npm install
TOGETHER_API_KEY=... npm start
```

Open `http://localhost:3000`.

The application first preflights `Qwen/Qwen3-0.6B` for both Together fine-tuning eligibility and dedicated-endpoint hardware before presenting it as supported. If it cannot deploy, the server tries `Qwen/Qwen3-1.7B` and then `Qwen/Qwen3-4B`, returning only the smallest candidate that passes both checks. Together does not expose an immutable model revision through this lifecycle, so the persisted revision is explicitly `null` with `revisionStatus: "unavailable-from-provider"`.

## Managed lifecycle

- Fine-tuning examples are validated on the server and written as conversation-format JSONL.
- The file is uploaded and validated through Together before a LoRA job is created.
- Together file and fine-tune job IDs are persisted, so page or Node-server reloads resume provider polling.
- Completed jobs must include a real output model identity before the fine-tuned state becomes runnable.
- Base inference uses Together serverless when the model is supported there; otherwise it uses the smallest available compatible dedicated hardware.
- Fine-tuned inference uses a dedicated endpoint and its exact endpoint model name.
- Stop deletes the dedicated endpoint so it no longer incurs idle endpoint charges.
- The app never silently falls back from the fine-tuned model to base.

Optional server settings:

- `TOGETHER_ARTIFACTS_PATH` defaults to `data/artifacts`.
- `TOGETHER_POLL_INTERVAL_MS` defaults to `2000`.
- `TOGETHER_FILE_TIMEOUT_MS` defaults to `120000`.
- `TOGETHER_ENDPOINT_TIMEOUT_MS` defaults to `900000`.

## Tests

Tests use mocked Together clients and never consume provider credits:

```bash
npm test
```

Explicit simulation is available only for tests or internal development:

```bash
APP_MODE=test npm start
# or
COMPUTE_PROVIDER=mock npm start
```

## Internal local proof

The earlier `MlxComputeProvider`, `MlxAdaptationTrainer`, and `OllamaComputeProvider` remain in the repository as internal development proofs. They are not the customer default and are not exposed as browser choices. Engineers can select them explicitly with `COMPUTE_PROVIDER=mlx` or `COMPUTE_PROVIDER=ollama` and the provider-specific environment variables documented in those modules and their tests.

There is no automatic provider fallback. The customer application fails startup clearly when `TOGETHER_API_KEY` is missing.
