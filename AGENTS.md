# Codex project instructions

## Product

This repository is the first vertical slice of **Replit for open-weight AI**.

The product loop is fixed:

> **Choose → Fork → Adapt → Run**

Do not introduce marketplaces, teams, enterprise governance, evaluation dashboards, RAG, generic workflows, or support for arbitrary models.

## Current scope

- One supported model: GLM-5.2
- One adaptation concept: LoRA
- One compute provider at a time
- One persistent workspace lineage
- One browser experience

## Engineering rules

- Preserve the domain terms `Choose`, `Fork`, `Adapt`, and `Run` in code and UI.
- `Fork` must retain an immutable reference to the base model and create a new owned lineage.
- `Adapt` is the umbrella domain term; LoRA fine-tuning is the first implementation.
- `Run` means allocate compute, load a model state, health-check it, and make inference available.
- Keep provider-specific logic behind an adapter.
- Never claim real training or inference occurred when mock compute is active.
- Prefer the smallest end-to-end implementation over abstractions for imagined features.
- Add tests for every state transition.

## Immediate task

Make the first real-compute path work for GLM-5.2 without expanding product scope. Read `docs/CODEX_BUILD_PROMPT.md` before changing code.
