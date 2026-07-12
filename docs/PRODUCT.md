# Product definition

## One-line explainer

**Cursor / Replit for Open-Weight AI.**

## Core promise

Choose an open-weight model, fork an owned lineage, fine-tune it from examples, and run the exact state inside one managed workspace.

## Product loop

### Choose

Choose the single model that has passed provider training and deployment preflight.

### Fork

Create an owned lineage referencing the provider's source and model identities. Record an exact revision only when the provider exposes one; otherwise record that it is unavailable.

### Fine-tune

Provide 5–20 user/assistant examples. The server validates and securely uploads them, starts one real Together LoRA job, and follows the provider through preparing, uploading, queued, training, publishing, complete, failed, or cancelled.

### Run

Run either Base or Fine-tuned with managed cloud inference. Chat becomes available only after real compute is ready. Stopping a dedicated endpoint releases it so idle billing ends.

## Product boundaries

Users never configure providers, API keys, GPU types, local weights, Python, MLX, Ollama, or terminals. The MVP does not include accounts, teams, billing, evaluations, RAG, governance, deployment choices, multiple models, or multiple cloud providers.
