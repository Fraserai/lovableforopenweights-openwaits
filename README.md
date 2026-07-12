# OpenWeight MVP

A focused vertical slice for **Replit for open-weight AI**.

The product loop is:

> **Choose → Fork → Adapt → Run**

Version `0.1.0` intentionally supports one product model (`GLM-5.2`) and one adaptation method (`LoRA` specification). It preserves the mock compute adapter and adds one real development path through Ollama. The real path uses `qwen3:0.6b` on development-sized hardware and never presents its output as GLM-5.2.

## Run locally

Requirements: Node.js 20+

Simulation mode requires no external runtime:

```bash
npm start
```

Open `http://localhost:3000`.

For automatic restart while editing:

```bash
npm run dev
```

Run tests:

```bash
npm test
```

### Real development runtime

Install [Ollama](https://ollama.com/download), then start its local API and download the development model:

```bash
ollama serve
ollama pull qwen3:0.6b
```

In another terminal, start OpenWeight with the real provider:

```bash
COMPUTE_PROVIDER=ollama OLLAMA_MODEL=qwen3:0.6b npm start
```

The Run action loads the model, polls `/api/ps` until it is healthy, and enables chat only after that transition. Stop unloads the model from memory with `keep_alive: 0`.

Required environment variables for real mode:

- `COMPUTE_PROVIDER=ollama`
- `OLLAMA_MODEL=qwen3:0.6b`

Optional environment variables:

- `OLLAMA_BASE_URL` defaults to `http://127.0.0.1:11434`.
- `OLLAMA_API_KEY` is only needed for an authenticated remote Ollama endpoint. Never commit it.
- `OLLAMA_KEEP_ALIVE` defaults to `-1m` so the model remains loaded until Stop.
- `OLLAMA_START_TIMEOUT_MS` defaults to `60000`.
- `OLLAMA_POLL_INTERVAL_MS` defaults to `250`.

## Current product contract

1. **Choose** a supported open-weight model.
2. **Fork** an owned lineage referencing the exact base model.
3. **Adapt** the fork by creating a LoRA adaptation specification.
4. **Run** that state through a compute provider and chat through its endpoint.

The latest workspace is restored after a browser reload. Run can target either the immutable base state or an existing adaptation specification.

## What is real today

- Model catalogue
- Fork lineage persisted to `data/workspaces.json`
- Adaptation state
- Run state
- API and browser UI
- Compute-provider abstraction
- End-to-end test of the product loop
- Real model load, health polling, chat, and unload through `OllamaComputeProvider`
- Genuine `qwen3:0.6b` responses when real mode is configured

## What is deliberately mocked

`MockComputeProvider` does not download GLM-5.2, allocate GPUs, train adapters, or execute inference. Its output is simulated and must not be interpreted as model output.

GLM-5.2 inference and LoRA training also remain unimplemented. On the current development hardware, Ollama runs `qwen3:0.6b` as an explicitly labelled substitute. Adaptation remains a persisted specification and is disabled as a real runnable state until training exists.

## Next engineering milestone

Connect the same truthful lifecycle to infrastructure capable of serving the pinned GLM-5.2 revision, without changing the product loop or silently falling back to the development model.

Do not add another product area until the four-step loop works with real compute.
