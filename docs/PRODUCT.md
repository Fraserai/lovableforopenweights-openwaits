# Product definition

## One-line explainer

**Replit for open-weight AI.**

## Core promise

Choose an existing open-weight model, fork your own lineage, adapt it, and run your version inside one live environment.

## Product loop

### Choose

Pick an exact model release and revision.

### Fork

Create an owned model lineage derived from the immutable base. Forking may use copy-on-write storage; it does not need to duplicate the full base weights.

### Adapt

Change the fork for a domain, task, behaviour, architecture, or deployment target. `Adapt` is the umbrella term. Version one only exposes LoRA fine-tuning.

### Run

Load a chosen model state onto compute and make inference usable through a playground and API.

## Non-goals

The application is not currently a model hub, GPU marketplace, evaluation platform, enterprise control plane, or no-code application builder.
