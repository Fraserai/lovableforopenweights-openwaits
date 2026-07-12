# Codex build brief: real GLM-5.2 compute

## Goal

Continue the existing repository by replacing mock compute with the smallest real GLM-5.2 inference path while preserving the product loop:

> Choose → Fork → Adapt → Run

## Confirmed product decisions

- The product is “Replit for open-weight AI.”
- GLM-5.2 is the only model in the first vertical slice.
- The user forks a lineage; the system should avoid copying immutable base weights unnecessarily.
- `Adapt` is the umbrella term. LoRA is the first adaptation method.
- The browser workspace must remain honest about what has and has not executed.
- Do not add evaluations, governance, teams, a marketplace, RAG, or unrelated model support.

## Existing implementation

- Dependency-free Node.js HTTP app
- Browser UI for all four stages
- JSON persistence
- `MockComputeProvider`
- End-to-end state-transition test

## Build the next smallest proof

Implement one `ComputeProvider` adapter that can start and stop a real, health-checked inference endpoint for the supported model or an explicitly documented development-sized substitute using the exact same provider contract.

If GLM-5.2 itself cannot be run in the available environment:

1. keep GLM-5.2 as the product model;
2. add a clearly labelled `developmentModelId` used only for local proof;
3. never present output from the substitute as GLM-5.2;
4. preserve the model-lineage contract;
5. document the production hardware blocker precisely.

## Required behaviour

- `start({ workspace })` returns provider, run ID, status, endpoint, hardware and timestamps.
- The endpoint is health-checked before the workspace becomes `running`.
- Chat requests proxy to the real inference server.
- A stop operation releases compute.
- Failures leave the workspace in a truthful non-running state with a useful message.
- Existing tests remain green; add focused provider tests.

## Done when

A developer can run the repository, choose GLM-5.2, fork it, define a LoRA adaptation specification, press Run, and receive either:

- real output from a correctly identified model; or
- a precise, honest infrastructure blocker with no fake success state.
