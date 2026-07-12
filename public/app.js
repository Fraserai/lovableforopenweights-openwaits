const state = {
  models: [],
  model: null,
  workspace: null,
  runtime: null,
  currentStage: "choose",
  runSelection: "base"
};

const notice = document.querySelector("#notice");

function byId(id) {
  return document.getElementById(id);
}

function setText(id, value) {
  byId(id).textContent = value;
}

function showNotice(message) {
  notice.textContent = message;
  notice.classList.remove("hidden");
}

function clearNotice() {
  notice.classList.add("hidden");
  notice.textContent = "";
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(payload.error || "Request failed");
    error.payload = payload;
    throw error;
  }
  return payload;
}

function openStage(stage) {
  state.currentStage = stage;
  document.querySelectorAll(".stage").forEach((element) => {
    element.classList.toggle("active-stage", element.id === stage);
  });
  renderSteps();
}

function stageIsUnlocked(stage) {
  if (stage === "choose") return true;
  if (stage === "fork") return Boolean(state.model);
  return Boolean(state.workspace);
}

function stageIsComplete(stage) {
  if (stage === "choose") return Boolean(state.model);
  if (stage === "fork") return Boolean(state.workspace);
  if (stage === "adapt") return Boolean(state.workspace?.adaptation);
  return state.workspace?.run?.status === "running";
}

function runStatusLabel(run) {
  if (!run) return "Not started";
  if (run.status === "starting") return "Starting";
  if (run.status === "running") {
    return run.realExecution ? "Running — real" : "Running — simulated";
  }
  if (run.status === "failed") return "Failed";
  if (run.status === "stopped") return "Stopped";
  return "Not started";
}

function renderSteps() {
  const statuses = {
    choose: state.model?.name || "Not chosen",
    fork: state.workspace?.name || "Not created",
    adapt: state.workspace?.adaptation?.name || "Not requested",
    run: runStatusLabel(state.workspace?.run)
  };

  document.querySelectorAll(".step").forEach((button) => {
    const stage = button.dataset.stage;
    button.disabled = !stageIsUnlocked(stage);
    button.classList.toggle("active", stage === state.currentStage);
    button.classList.toggle("complete", stageIsComplete(stage));
    setText(`${stage}-step-status`, statuses[stage]);
  });
}

function shortRevision(revision) {
  return revision ? revision.slice(0, 9) : "unavailable";
}

function renderRuntimeIdentity() {
  const runtime = state.runtime;
  if (!runtime) return;
  const real = runtime.realExecution;
  const badge = byId("environment-badge");
  badge.classList.toggle("real", real);
  badge.classList.toggle("simulation", !real);
  setText(
    "environment-label",
    real ? `Real development runtime · ${runtime.actualModelId}` : "Simulation environment"
  );

  const flag = byId("execution-flag");
  flag.classList.toggle("real", real);
  flag.classList.toggle("simulation", !real);
  flag.textContent = real ? "Real development output" : "Simulated output";

  setText("actual-model-banner", real ? runtime.actualModelId : "No model loaded");
  setText(
    "runtime-identity-note",
    real
      ? `Real via ${runtime.providerDisplayName}; development substitute, not GLM-5.2`
      : "No model inference; responses are simulated"
  );
  const playgroundMode = byId("playground-mode");
  playgroundMode.textContent = real ? "Real" : "Simulation";
  playgroundMode.classList.toggle("real", real);
}

function renderModelList() {
  const list = byId("model-list");
  list.replaceChildren();

  state.models.forEach((model) => {
    const card = document.createElement("article");
    card.className = "model-card";

    const visual = document.createElement("div");
    visual.className = "model-visual";
    visual.textContent = "5.2";

    const content = document.createElement("div");
    const meta = document.createElement("div");
    meta.className = "model-meta";
    const publisher = document.createElement("span");
    publisher.textContent = model.publisher;
    const revision = document.createElement("span");
    revision.textContent = `Revision ${shortRevision(model.revision)}`;
    meta.append(publisher, revision);

    const title = document.createElement("h3");
    title.textContent = model.name;
    const summary = document.createElement("p");
    summary.textContent = model.summary;

    const tags = document.createElement("div");
    tags.className = "model-tags";
    [model.license, model.modality, "LoRA"].forEach((tag) => {
      const element = document.createElement("span");
      element.textContent = tag;
      tags.appendChild(element);
    });

    const button = document.createElement("button");
    button.className = "primary";
    button.type = "button";
    button.textContent = state.model?.id === model.id ? `${model.name} chosen` : `Choose ${model.name}`;
    button.addEventListener("click", () => {
      state.model = model;
      byId("fork-name").value = `My ${model.name}`;
      renderAll();
      openStage("fork");
    });

    content.append(meta, title, summary, tags, button);
    card.append(visual, content);
    list.appendChild(card);
  });
}

function renderForkSource() {
  const source = byId("fork-source");
  source.replaceChildren();
  if (!state.model) return;

  const model = document.createElement("strong");
  model.textContent = state.model.name;
  const details = document.createElement("div");
  details.textContent = `Source ${state.model.id} at ${shortRevision(state.model.revision)}. The base reference remains immutable.`;
  source.append(model, details);
}

function renderSummary() {
  const workspace = state.workspace;
  const run = workspace?.run;
  setText("chosen-model-state", state.model ? `${state.model.name} @ ${shortRevision(state.model.revision)}` : "None");
  setText("fork-state", workspace?.name || "Not created");
  setText("adaptation-state", workspace?.adaptation?.objective || "Not requested");
  setText(
    "active-state",
    run?.status === "running" || run?.status === "starting"
      ? run.actualModelId || run.modelState?.label || "Starting"
      : "Not running"
  );
  setText("execution-state", runStatusLabel(run));
  byId("execution-state").className = run?.status === "running"
    ? run.realExecution ? "real-text" : "simulation-text"
    : run?.status === "failed"
      ? "failed-text"
      : "";
}

function appendMessage(role, content, label) {
  const messages = byId("messages");
  messages.querySelector(".empty-state")?.remove();
  const element = document.createElement("p");
  element.className = `message ${role}`;
  const meta = document.createElement("small");
  meta.textContent = label;
  const body = document.createElement("span");
  body.textContent = content;
  element.append(meta, body);
  messages.appendChild(element);
  messages.scrollTop = messages.scrollHeight;
}

function resetPlayground(message) {
  const messages = byId("messages");
  messages.replaceChildren();
  const empty = document.createElement("p");
  empty.className = "empty-state";
  empty.textContent = message;
  messages.appendChild(empty);
  delete messages.dataset.runId;
}

function renderRun() {
  const workspace = state.workspace;
  const runtime = state.runtime;
  if (!workspace || !runtime) return;

  setText("base-revision", workspace.baseModel.revision);
  const adaptedInput = document.querySelector('input[name="model-state"][value="adapted"]');
  const adaptedRunnable = Boolean(workspace.adaptation) && runtime.supportsAdaptedState;
  adaptedInput.disabled = !adaptedRunnable;
  setText(
    "adapted-state-label",
    !workspace.adaptation
      ? "Create an adaptation first"
      : adaptedRunnable
        ? workspace.adaptation.name
        : "Specification only; no trained adapter"
  );
  setText(
    "adaptation-objective-summary",
    workspace.adaptation?.objective || "No adaptation requested. The base state is available."
  );

  if (state.runSelection === "adapted" && !adaptedRunnable) state.runSelection = "base";
  document.querySelectorAll('input[name="model-state"]').forEach((input) => {
    input.checked = input.value === state.runSelection;
  });

  const run = workspace.run;
  const running = run?.status === "running";
  const starting = run?.status === "starting";
  const real = run?.realExecution ?? runtime.realExecution;
  setText("run-status", runStatusLabel(run));
  byId("run-dot").className = `status-dot ${run?.status || "idle"}`;
  setText("provider-detail", run?.providerDisplayName || runtime.providerDisplayName);
  setText("actual-model-detail", run?.actualModelId || runtime.actualModelId || "No model (simulation)");
  setText("hardware-detail", run?.hardware || runtime.hardware);
  setText("backend-detail", run?.backendEndpoint || runtime.backendEndpoint || "Not applicable");
  setText("endpoint", running ? `${window.location.origin}${run.endpoint}` : "Available after start");
  setText("playground-title", running ? run.actualModelId || run.modelState.label : "No active state");

  const error = byId("run-error");
  error.textContent = run?.error || "";
  error.classList.toggle("hidden", !run?.error);

  const sameState = running && run.modelState.kind === state.runSelection;
  const runButton = byId("run-button");
  runButton.disabled = starting;
  runButton.textContent = starting
    ? "Starting runtime..."
    : running && sameState
      ? real ? "Restart real runtime" : "Restart simulation"
      : running
        ? "Start selected state"
        : real ? "Start real runtime" : "Start simulation";

  const stopButton = byId("stop-button");
  stopButton.classList.toggle("hidden", !running);
  stopButton.disabled = !running;

  const chatInput = byId("chat-input");
  const chatButton = document.querySelector("#chat-form button");
  chatInput.disabled = !running;
  chatButton.disabled = !running;

  const messages = byId("messages");
  if (running && messages.dataset.runId !== run.id) {
    resetPlayground("");
    messages.querySelector(".empty-state")?.remove();
    messages.dataset.runId = run.id;
    if (run.realExecution) {
      appendMessage(
        "assistant",
        `${run.actualModelId} is running through ${run.providerDisplayName}. This is genuine model inference from a development substitute, not GLM-5.2.`,
        `${run.providerDisplayName} · ${run.actualModelId} · Real`
      );
    } else {
      appendMessage(
        "assistant",
        `The ${run.modelState.label} state is ready in simulation. No GLM-5.2 weights, training, or inference are running.`,
        "Simulation"
      );
    }
  } else if (!running && !messages.querySelector(".empty-state")) {
    const message = run?.status === "failed"
      ? "The runtime failed. Review the error and start it again."
      : run?.status === "stopped"
        ? "The runtime is stopped. Start it to use the playground."
        : "Start a state to open the playground.";
    resetPlayground(message);
  }
}

function renderAll() {
  renderRuntimeIdentity();
  renderModelList();
  renderForkSource();
  renderSummary();
  renderSteps();
  renderRun();
}

async function refreshWorkspace() {
  if (!state.workspace) return;
  const { workspace } = await api(`/api/workspaces/${state.workspace.id}`);
  state.workspace = workspace;
  renderAll();
}

document.querySelectorAll(".step").forEach((button) => {
  button.addEventListener("click", () => {
    if (!button.disabled) openStage(button.dataset.stage);
  });
});

document.querySelectorAll('input[name="model-state"]').forEach((input) => {
  input.addEventListener("change", () => {
    state.runSelection = input.value;
    renderRun();
  });
});

byId("fork-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  clearNotice();
  try {
    const { workspace } = await api("/api/workspaces", {
      method: "POST",
      body: JSON.stringify({
        modelId: state.model.id,
        name: byId("fork-name").value
      })
    });
    state.workspace = workspace;
    state.runSelection = "base";
    renderAll();
    openStage("adapt");
  } catch (error) {
    showNotice(error.message);
  }
});

byId("adapt-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  clearNotice();
  try {
    const { workspace } = await api(`/api/workspaces/${state.workspace.id}/adapt`, {
      method: "POST",
      body: JSON.stringify({
        name: byId("adapt-name").value,
        objective: byId("adapt-objective").value
      })
    });
    state.workspace = workspace;
    state.runSelection = state.runtime.supportsAdaptedState ? "adapted" : "base";
    resetPlayground("Start a state to open the playground.");
    renderAll();
    openStage("run");
  } catch (error) {
    showNotice(error.message);
  }
});

byId("run-button").addEventListener("click", async () => {
  clearNotice();
  const previousRun = state.workspace.run;
  state.workspace.run = {
    ...previousRun,
    provider: state.runtime.provider,
    providerDisplayName: state.runtime.providerDisplayName,
    executionMode: state.runtime.executionMode,
    realExecution: state.runtime.realExecution,
    actualModelId: state.runtime.actualModelId,
    hardware: state.runtime.hardware,
    backendEndpoint: state.runtime.backendEndpoint,
    status: "starting",
    error: null,
    modelState: {
      kind: state.runSelection,
      label: state.runSelection === "adapted"
        ? state.workspace.adaptation.name
        : state.runtime.actualModelId
          ? `${state.runtime.actualModelId} development model`
          : `${state.workspace.baseModel.name} base`
    }
  };
  renderAll();

  try {
    const { workspace } = await api(`/api/workspaces/${state.workspace.id}/run`, {
      method: "POST",
      body: JSON.stringify({ modelState: state.runSelection })
    });
    state.workspace = workspace;
    renderAll();
  } catch (error) {
    showNotice(error.message);
    await refreshWorkspace().catch(() => {});
  }
});

byId("stop-button").addEventListener("click", async () => {
  clearNotice();
  const button = byId("stop-button");
  button.disabled = true;
  button.textContent = "Stopping...";
  try {
    const { workspace } = await api(`/api/workspaces/${state.workspace.id}/stop`, {
      method: "POST",
      body: "{}"
    });
    state.workspace = workspace;
    renderAll();
  } catch (error) {
    showNotice(error.message);
    await refreshWorkspace().catch(() => {});
  } finally {
    button.textContent = "Stop runtime";
  }
});

byId("chat-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  clearNotice();
  const input = byId("chat-input");
  const message = input.value.trim();
  if (!message) return;
  input.value = "";
  appendMessage("user", message, "You");
  try {
    const payload = await api(`/api/workspaces/${state.workspace.id}/chat`, {
      method: "POST",
      body: JSON.stringify({ message })
    });
    const result = payload.message;
    const label = result.realExecution
      ? `${result.providerDisplayName} · ${result.actualModelId} · Real`
      : "Simulated response";
    appendMessage("assistant", result.content, label);
  } catch (error) {
    showNotice(error.message);
    await refreshWorkspace().catch(() => {});
  }
});

async function loadApp() {
  try {
    const [{ models }, { workspaces }, health] = await Promise.all([
      api("/api/models"),
      api("/api/workspaces"),
      api("/api/health")
    ]);
    state.models = models;
    state.runtime = health.runtime;

    let latest = [...workspaces].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)).at(-1);
    if (latest?.run && ["starting", "running"].includes(latest.run.status)) {
      const status = await api(`/api/workspaces/${latest.id}/run/status`);
      latest = status.workspace;
    }

    if (latest) {
      state.workspace = latest;
      state.model = models.find((model) => model.id === latest.baseModel.id) || null;
      state.runSelection = latest.run?.modelState?.kind || (latest.adaptation ? "adapted" : "base");
      if (!state.runtime.supportsAdaptedState) state.runSelection = "base";
    }

    renderAll();
    if (latest?.run || latest?.adaptation) openStage("run");
    else if (latest) openStage("adapt");
    else openStage("choose");
  } catch (error) {
    showNotice(error.message);
  }
}

loadApp();
