# OpenWeight MVP

A focused vertical slice for **Replit for open-weight AI**.

The product loop is:

> **Choose → Fork → Adapt → Run**

Version `0.1.0` intentionally supports one model (`GLM-5.2`) and one adaptation method (`LoRA` specification). It uses a mock compute adapter so the complete application flow runs without GPU credentials or downloading model weights. The interface and API label every mock run and playground response as simulation.

## Run locally

Requirements: Node.js 20+

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

## What is deliberately mocked

`MockComputeProvider` does not download GLM-5.2, allocate GPUs, train adapters, or execute inference. Its output is simulated and must not be interpreted as model output. Its purpose is to make the product state machine and interface testable before choosing infrastructure.

## Next engineering milestone

Replace `lib/compute/mock-provider.mjs` with one real provider adapter that can:

1. allocate a GPU worker;
2. mount or cache a supported model revision;
3. start an inference server;
4. return a health-checked endpoint;
5. stop the worker cleanly.

Do not add another product area until the four-step loop works with real compute.
