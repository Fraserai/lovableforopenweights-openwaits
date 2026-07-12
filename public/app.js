const state = {
  models: [],
  model: null,
  workspace: null,
  currentStage: "choose",
  runSelection: "base"
};

const stageOrder = ["choose", "fork", "adapt", "run"];
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
  if (!response.ok) throw new Error(payload.error || "Request failed");
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

function renderSteps() {
  const statuses = {
    choose: state.model?.name || "Not chosen",
    fork: state.workspace?.name || "Not created",
    adapt: state.workspace?.adaptation?.name || "Not requested",
    run: state.workspace?.run?.status === "running" ? "Simulation ready" : "Not started"
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
  setText("chosen-model-state", state.model ? `${state.model.name} @ ${shortRevision(state.model.revision)}` : "None");
  setText("fork-state", workspace?.name || "Not created");
  setText("adaptation-state", workspace?.adaptation?.objective || "Not requested");

  const running = workspace?.run?.status === "running";
  setText("active-state", running ? workspace.run.modelState.label : "Not started");
  setText("execution-state", running ? "Simulation running" : "Simulation");
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
  if (!workspace) return;

  setText("base-revision", workspace.baseModel.revision);
  const adaptedInput = document.querySelector('input[name="model-state"][value="adapted"]');
  adaptedInput.disabled = !workspace.adaptation;
  setText("adapted-state-label", workspace.adaptation?.name || "Create an adaptation first");
  setText(
    "adaptation-objective-summary",
    workspace.adaptation?.objective || "No adaptation requested. The base state is available."
  );

  if (state.runSelection === "adapted" && !workspace.adaptation) state.runSelection = "base";
  document.querySelectorAll('input[name="model-state"]').forEach((input) => {
    input.checked = input.value === state.runSelection;
  });

  const run = workspace.run;
  const running = run?.status === "running";
  const failed = run?.status === "failed";
  const status = running ? "Simulation ready" : failed ? "Start failed" : "Not started";
  setText("run-status", status);
  byId("run-dot").classList.toggle("running", running);
  setText("provider-detail", run?.provider || "Mock compute");
  setText("hardware-detail", run?.hardware || "Simulated GPU");
  setText("endpoint", running ? `${window.location.origin}${run.endpoint}` : "Available after start");
  setText("playground-title", running ? run.modelState.label : "No active state");

  const sameState = running && run.modelState.kind === state.runSelection;
  setText("run-button", sameState ? "Restart simulation" : running ? "Start selected state" : "Start simulation");

  const chatInput = byId("chat-input");
  const chatButton = document.querySelector("#chat-form button");
  chatInput.disabled = !running;
  chatButton.disabled = !running;

  const messages = byId("messages");
  if (running && messages.dataset.runId !== run.id) {
    resetPlayground("");
    messages.querySelector(".empty-state")?.remove();
    messages.dataset.runId = run.id;
    appendMessage(
      "assistant",
      `The ${run.modelState.label} state is ready in simulation. No GLM-5.2 weights, training, or inference are running.`,
      "Simulation"
    );
  } else if (!running && !messages.querySelector(".empty-state")) {
    resetPlayground("Start a state to try the simulated playground.");
  }
}

function renderAll() {
  renderModelList();
  renderForkSource();
  renderSummary();
  renderSteps();
  renderRun();
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
    state.runSelection = "adapted";
    resetPlayground("Start a state to try the simulated playground.");
    renderAll();
    openStage("run");
  } catch (error) {
    showNotice(error.message);
  }
});

byId("run-button").addEventListener("click", async () => {
  clearNotice();
  const button = byId("run-button");
  button.disabled = true;
  button.textContent = "Starting simulation...";
  try {
    const { workspace } = await api(`/api/workspaces/${state.workspace.id}/run`, {
      method: "POST",
      body: JSON.stringify({ modelState: state.runSelection })
    });
    state.workspace = workspace;
    renderAll();
  } catch (error) {
    showNotice(error.message);
    try {
      const { workspace } = await api(`/api/workspaces/${state.workspace.id}`);
      state.workspace = workspace;
      renderAll();
    } catch {
      button.textContent = "Start simulation";
    }
  } finally {
    button.disabled = false;
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
    appendMessage("assistant", payload.message.content, "Simulated response");
  } catch (error) {
    showNotice(error.message);
  }
});

async function loadApp() {
  try {
    const [{ models }, { workspaces }] = await Promise.all([
      api("/api/models"),
      api("/api/workspaces")
    ]);
    state.models = models;

    const latest = [...workspaces].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)).at(-1);
    if (latest) {
      state.workspace = latest;
      state.model = models.find((model) => model.id === latest.baseModel.id) || null;
      state.runSelection = latest.run?.modelState?.kind || (latest.adaptation ? "adapted" : "base");
    }

    renderAll();
    if (latest?.run?.status === "running" || latest?.adaptation) openStage("run");
    else if (latest) openStage("adapt");
    else openStage("choose");
  } catch (error) {
    showNotice(error.message);
  }
}

loadApp();
