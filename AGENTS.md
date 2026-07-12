# Codex project instructions

## Product

This repository is the first vertical slice of **Cursor / Replit for Open-Weight AI**.

The customer-facing product loop is fixed:

> **Choose → Fork → Fine-tune → Run**

## Current scope

- One supported cloud-served model
- One fine-tuning method: LoRA supervised fine-tuning
- One managed provider: Together AI
- One persistent workspace lineage
- One browser experience

## Engineering rules

- Use `Choose`, `Fork`, `Fine-tune`, and `Run` in customer-facing language. Never use `Adapt` in the interface.
- `Fork` retains an immutable provider/source model reference and creates an owned lineage.
- The browser never requests API keys, providers, GPU types, model paths, or local infrastructure setup.
- `TOGETHER_API_KEY` is server-only and must never be returned or persisted in workspace data.
- Together file, fine-tuning job, output model, and endpoint IDs are persisted for truthful recovery.
- A fine-tune is complete only after Together reports completion and an output model identity.
- Fine-tuned inference never silently falls back to base.
- Stop must release or delete dedicated compute.
- Keep provider-specific logic behind the existing adapter boundary.
- Preserve MLX and Ollama as internal development proofs; do not expose or expand them by default.
- Mock compute is allowed only through explicit test/development configuration and is always labelled simulation.
- Do not add models, cloud providers, accounts, billing, teams, evaluations, RAG, governance, or enterprise features.
- Add focused tests for every state transition without using live provider billing.
