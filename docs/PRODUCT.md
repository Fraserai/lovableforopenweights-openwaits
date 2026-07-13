# Product definition

## One-line explainer

**Cursor / Replit for Open-Weight AI.**

## Core promise

Choose an open-weight model, fork an owned lineage, fine-tune it from examples, and run the exact state inside one managed workspace.

## Product posture

**OpenWeight builds models, not agents.**

The product provides a neutral model-building toolkit. It does not prescribe assistants, copilots, personas, workflows, or end-user applications. Users decide what their model should become and what they build with it; OpenWeight supplies the tools to choose, fork, fine-tune, and run that model.

## Product loop

### Choose

Choose the single model that has passed provider training and deployment preflight.

### Fork

Create an owned lineage referencing the provider's source and model identities. Record an exact revision only when the provider exposes one; otherwise record that it is unavailable.

### Fine-tune

Provide 5–20 user-message and ideal-model-response examples. The server validates and securely uploads them, starts one real Together LoRA job, and follows the provider through preparing, uploading, queued, training, publishing, complete, failed, or cancelled.

### Run

Run either Base or Fine-tuned with managed cloud inference. Chat becomes available only after real compute is ready. Stopping a dedicated endpoint releases it so idle billing ends.

## Product boundaries

Users never configure providers, API keys, GPU types, local weights, Python, MLX, Ollama, or terminals. The MVP does not include accounts, teams, billing, evaluations, RAG, governance, deployment choices, agents, copilots, workflow builders, multiple models, or multiple cloud providers.
