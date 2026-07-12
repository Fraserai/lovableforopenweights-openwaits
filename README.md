# OpenWeight MVP

A focused **Choose → Fork → Adapt → Run** vertical slice for open-weight AI.

The supported development model is `mlx-community/Qwen3-0.6B-4bit`, pinned to revision `73e3e38d981303bc594367cd910ea6eb48349da8`. The same local snapshot is used for both LoRA training and inference.

## Simulation

Requirements: Node.js 20+

```bash
npm start
```

Open `http://localhost:3000`. The default `MockComputeProvider` labels every run and response as simulation.

## Real MLX lifecycle

Requirements: Apple Silicon, Node.js 20+, Python 3.10+, and MLX-LM 0.31.3.

Create an isolated Python environment and download the exact model revision:

```bash
python3 -m venv .venv
.venv/bin/pip install 'mlx-lm[train]==0.31.3'
.venv/bin/python -c 'from huggingface_hub import snapshot_download; snapshot_download(repo_id="mlx-community/Qwen3-0.6B-4bit", revision="73e3e38d981303bc594367cd910ea6eb48349da8", local_dir="data/models/qwen3-0.6b-4bit-73e3e38")'
```

Start the app with the one real adaptation provider:

```bash
COMPUTE_PROVIDER=mlx \
MLX_MODEL_PATH="$PWD/data/models/qwen3-0.6b-4bit-73e3e38" \
MLX_SERVER_COMMAND="$PWD/.venv/bin/mlx_lm.server" \
MLX_LORA_COMMAND="$PWD/.venv/bin/mlx_lm.lora" \
npm start
```

Required environment variables:

- `COMPUTE_PROVIDER=mlx`
- `MLX_MODEL_PATH`: local snapshot of the pinned revision
- `MLX_SERVER_COMMAND`: MLX-LM server executable
- `MLX_LORA_COMMAND`: MLX-LM LoRA executable

Optional MLX variables:

- `MLX_ARTIFACTS_PATH` defaults to `data/artifacts`.
- `MLX_TRAIN_ITERS` defaults to `20`.
- `MLX_TRAIN_LAYERS` defaults to `4`.
- `MLX_TRAIN_LEARNING_RATE` defaults to `0.0001`.
- `MLX_START_TIMEOUT_MS` defaults to `120000`.
- `MLX_POLL_INTERVAL_MS` defaults to `250`.

The real flow accepts 5–20 structured examples, writes MLX chat-format training data, creates a LoRA adapter, verifies `adapters.safetensors`, and only then enables adapted inference. Adapted startup passes the adapter path directly to `mlx_lm.server`; missing or invalid weights fail without falling back to base.

## Other providers

`MockComputeProvider` and `OllamaComputeProvider` remain available. Ollama's `qwen3:0.6b` artifact is explicitly treated as a different artifact from the pinned Hugging Face/MLX revision and cannot run this adapter. Providers are selected only through `COMPUTE_PROVIDER`; there is no automatic fallback.

## Tests

```bash
npm test
```

Workspace, adaptation, artifact, and runtime metadata persist in the configured data file so browser reloads recover honest state.
