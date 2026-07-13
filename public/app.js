const state = {
  models: [],
  model: null,
  workspace: null,
  runtime: null,
  currentStage: "choose",
  runSelection: "base",
  activeExampleIndex: 0,
  adaptationPoll: null
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
  if (stage === "adapt") return ["complete", "simulated"].includes(fineTuneOf(state.workspace)?.status);
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
  const fineTune = fineTuneOf(state.workspace);
  const statuses = {
    choose: state.model?.name || "Not chosen",
    fork: state.workspace?.name || "Not created",
    adapt: fineTune ? `${fineTune.name} · ${fineTuneStatusLabel(fineTune.status)}` : "Not started",
    run: runStatusLabel(state.workspace?.run)
  };

  document.querySelectorAll(".step").forEach((button) => {
    const stage = button.dataset.stage;
    button.disabled = !stageIsUnlocked(stage);
    button.classList.toggle("active", stage === state.currentStage);
    button.classList.toggle("complete", stageIsComplete(stage));
    if (stage === state.currentStage) button.setAttribute("aria-current", "step");
    else button.removeAttribute("aria-current");
    setText(`${stage}-step-status`, statuses[stage]);
  });
}

function shortRevision(revision) {
  return revision ? revision.slice(0, 9) : "unavailable";
}

function fineTuneOf(workspace) {
  return workspace?.fineTune || workspace?.adaptation || null;
}

function fineTuneStatusLabel(status) {
  return {
    preparing: "Preparing",
    uploading: "Uploading securely",
    queued: "Queued",
    training: "Fine-tuning",
    publishing: "Publishing",
    complete: "Complete",
    failed: "Failed",
    cancelled: "Cancelled",
    simulated: "Simulated"
  }[status] || "Not started";
}

function renderRuntimeIdentity() {
  const runtime = state.runtime;
  if (!runtime) return;
  const real = runtime.realExecution;
  const badge = byId("environment-badge");
  badge.classList.toggle("real", real);
  badge.classList.toggle("simulation", !real);
  const managed = runtime.provider === "together";
  setText(
    "environment-label",
    managed
      ? "Real hosted execution"
      : real ? `Internal runtime · ${runtime.providerDisplayName}` : "Explicit test simulation"
  );

  const flag = byId("execution-flag");
  flag.classList.toggle("real", real);
  flag.classList.toggle("simulation", !real);
  flag.textContent = managed ? "Real cloud output" : real ? "Real internal output" : "Simulated output";

  setText("actual-model-banner", real ? runtime.actualModelId : "No model loaded");
  setText(
    "runtime-identity-note",
    managed
      ? "Hosted execution; no local setup required"
      : real
        ? `Internal development provider · ${runtime.providerDisplayName}`
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
    visual.innerHTML = `
      <span class="weight-label">0.6B</span>
      <span class="weight-layers" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>
    `;

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
    summary.textContent = "A compact open-weight model ready to fork, teach, and run.";

    const tags = document.createElement("div");
    tags.className = "model-tags";
    [model.license, model.modality, "Adaptable"].forEach((tag) => {
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

  if (state.workspace?.name) byId("fork-name").value = state.workspace.name;

  setText("lineage-base-name", state.model.name);
  setText("lineage-fork-name", byId("fork-name").value || "Untitled fork");
  setText("fork-base-model", state.model.name);
  setText("fork-base-publisher", state.model.publisher);
  setText("fork-base-parameters", state.model.parameterCount || "Unavailable");
  setText("fork-base-license", state.model.license);
  const sourceLink = byId("fork-source-link");
  sourceLink.href = state.model.sourceUrl;

  const model = document.createElement("strong");
  model.textContent = state.model.name;
  const details = document.createElement("div");
  details.textContent = state.model.revision
    ? `Source ${state.model.id} at ${shortRevision(state.model.revision)}. The base reference remains immutable.`
    : `Source ${state.model.id}. The base identity remains fixed.`;
  source.append(model, details);
}

function renderSummary() {
  const workspace = state.workspace;
  const fineTune = fineTuneOf(workspace);
  const run = workspace?.run;
  setText(
    "chosen-model-state",
    state.model
      ? state.model.revision
        ? `${state.model.name} @ ${shortRevision(state.model.revision)}`
        : `${state.model.name} · revision unavailable`
      : "None"
  );
  setText("fork-state", workspace?.name || "Not created");
  setText("adaptation-state", fineTune?.objective || "Not started");
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

function renderAdaptation() {
  const adaptation = fineTuneOf(state.workspace);
  const progress = byId("adaptation-progress");
  progress.classList.toggle("hidden", !adaptation);
  if (!adaptation) return;

  const form = byId("adapt-form");
  if (form.dataset.adaptationId !== adaptation.id) {
    form.dataset.adaptationId = adaptation.id;
    byId("adapt-objective").value = adaptation.objective;
    byId("adapt-name").value = adaptation.name;
    byId("examples-list").replaceChildren();
    state.activeExampleIndex = 0;
    (adaptation.examples || []).forEach((example) => addExample(example));
    while (byId("examples-list").children.length < 5) addExample();
  }

  setText("adaptation-status", fineTuneStatusLabel(adaptation.status));
  setText(
    "adaptation-status-note",
    adaptation.status === "preparing"
      ? "Preparing your examples…"
      : adaptation.status === "uploading"
        ? "Uploading securely…"
        : adaptation.status === "queued"
          ? "Your fine-tune is queued."
          : adaptation.status === "training"
            ? "Fine-tuning your version. You can safely reload this page."
            : adaptation.status === "publishing"
              ? "Publishing your model…"
      : adaptation.status === "complete"
        ? `${adaptation.exampleCount} examples produced a real fine-tuned model.`
        : adaptation.status === "failed"
          ? adaptation.error || "Fine-tuning failed. Update the examples and try again."
          : adaptation.status === "simulated"
            ? "Simulation only: no model weights were changed."
            : "Waiting to start."
  );
  setText("adaptation-backend", adaptation.provider || adaptation.trainingBackend || "Simulation");
  setText("adaptation-revision", adaptation.baseRevision || "Unavailable from provider");
  setText("adaptation-path", adaptation.outputModelId || adaptation.fineTuneJobId || "Not published");
  const config = adaptation.configuration;
  setText(
    "adaptation-config",
    config
      ? config.trainingType
        ? `${config.trainingType} · ${config.epochs} epoch · rank ${config.loraRank}`
        : `${config.iterations} steps · ${config.numLayers} layers · batch ${config.batchSize}`
      : "Not applicable"
  );
  setText("adaptation-logs", adaptation.error || adaptation.logs || "Provider progress is available while the job runs.");

  const active = ["preparing", "uploading", "queued", "training", "publishing"].includes(adaptation.status);
  byId("adapt-button").disabled = active;
  byId("adapt-button").textContent = active ? "Fine-tuning…" : "Fine-tune";
  scheduleAdaptationPoll(active);
}

function scheduleAdaptationPoll(training) {
  if (!training) {
    clearTimeout(state.adaptationPoll);
    state.adaptationPoll = null;
    return;
  }
  if (state.adaptationPoll) return;
  state.adaptationPoll = setTimeout(async () => {
    state.adaptationPoll = null;
    await refreshFineTune().catch((error) => showNotice(error.message));
  }, 1_000);
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

  const fineTune = fineTuneOf(workspace);
  setText("base-revision", workspace.baseModel.revision || "Unavailable from provider");
  setText(
    "base-state-label",
    workspace.baseModel.revision
      ? `${workspace.baseModel.name} @ ${shortRevision(workspace.baseModel.revision)}`
      : `${workspace.baseModel.name} · fixed base identity`
  );
  const adaptedInput = document.querySelector('input[name="model-state"][value="fine-tuned"]');
  const adaptedRunnable = Boolean(fineTune) && runtime.supportsAdaptedState &&
    (!runtime.realExecution || fineTune.status === "complete");
  adaptedInput.disabled = !adaptedRunnable;
  setText(
    "adapted-state-label",
    !fineTune
      ? "Fine-tune your fork first"
      : ["preparing", "uploading", "queued", "training", "publishing"].includes(fineTune.status)
        ? fineTuneStatusLabel(fineTune.status)
        : fineTune.status === "failed"
          ? "Fine-tuning failed"
          : adaptedRunnable
            ? fineTune.name
            : "No runnable fine-tuned model"
  );
  setText(
    "adaptation-objective-summary",
    fineTune?.objective || "No fine-tune started. The base state is available."
  );

  if (state.runSelection === "fine-tuned" && !adaptedRunnable) state.runSelection = "base";
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
        `${run.modelState.label} is ready through ${run.providerDisplayName}. This is genuine inference from ${run.actualModelId}.`,
        `${run.providerDisplayName} · ${run.actualModelId} · Real`
      );
    } else {
      appendMessage(
        "assistant",
        `The ${run.modelState.label} state is ready in simulation. No cloud fine-tuning or inference is running.`,
        "Simulation"
      );
    }
    (run.conversation || []).forEach((message) => {
      appendMessage(
        message.role === "assistant" ? "assistant" : "user",
        message.content,
        message.role === "assistant"
          ? run.realExecution
            ? `${run.providerDisplayName} · ${run.actualModelId} · Real`
            : "Simulated response"
          : "You"
      );
    });
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
  renderAdaptation();
  renderSteps();
  renderRun();
}

function addExample(example = {}, { select = false } = {}) {
  const list = byId("examples-list");
  if (list.children.length >= 20) return;
  const row = document.createElement("div");
  row.className = "example-row";
  const index = list.children.length + 1;
  row.innerHTML = `
    <div class="example-head">
      <div><small>Conversation pair</small><strong>Example ${String(index).padStart(2, "0")}</strong></div>
      <button class="remove-example" type="button">Remove</button>
    </div>
    <label class="example-field user-field"><span><b>U</b>User message</span><textarea class="example-user" maxlength="4000" placeholder="What the user asks"></textarea></label>
    <span class="pair-arrow" aria-hidden="true">&rarr;</span>
    <label class="example-field assistant-field"><span><b>A</b>Ideal response</span><textarea class="example-assistant" maxlength="8000" placeholder="The exact response your version should give"></textarea></label>
  `;
  row.querySelector(".example-user").value = example.user || "";
  row.querySelector(".example-assistant").value = example.assistant || "";
  row.querySelectorAll("textarea").forEach((field) => {
    field.addEventListener("input", renderExampleStudio);
  });
  row.querySelector(".remove-example").addEventListener("click", () => {
    if (list.children.length <= 5) return;
    const removedIndex = [...list.children].indexOf(row);
    row.remove();
    if (removedIndex < state.activeExampleIndex) state.activeExampleIndex -= 1;
    state.activeExampleIndex = Math.min(state.activeExampleIndex, list.children.length - 1);
    renderExampleStudio();
  });
  list.appendChild(row);
  if (select) state.activeExampleIndex = list.children.length - 1;
  renderExampleStudio();
}

function renderExampleStudio() {
  const rows = [...byId("examples-list").children];
  const count = rows.length;
  const completed = rows.filter((row) => (
    row.querySelector(".example-user").value.trim()
    && row.querySelector(".example-assistant").value.trim()
  )).length;
  const ready = count >= 5 && completed === count;
  state.activeExampleIndex = Math.max(0, Math.min(state.activeExampleIndex, count - 1));

  setText("examples-count", `${count} ${count === 1 ? "example" : "examples"}`);
  setText("examples-readiness", ready ? "Example set ready" : `${completed} of ${count} complete`);
  byId("examples-readiness").classList.toggle("ready", ready);
  byId("example-progress-bar").style.width = `${count ? (completed / count) * 100 : 0}%`;
  setText("example-position", `Example ${state.activeExampleIndex + 1} of ${count}`);
  byId("add-example").disabled = count >= 20;
  byId("previous-example").disabled = state.activeExampleIndex === 0;
  byId("next-example").disabled = state.activeExampleIndex >= count - 1;

  const navigation = byId("example-nav");
  navigation.replaceChildren();
  rows.forEach((row, index) => {
    const isComplete = Boolean(
      row.querySelector(".example-user").value.trim()
      && row.querySelector(".example-assistant").value.trim()
    );
    row.hidden = index !== state.activeExampleIndex;
    row.querySelector(".example-head strong").textContent = `Example ${String(index + 1).padStart(2, "0")}`;
    row.querySelector(".remove-example").disabled = count <= 5;

    const button = document.createElement("button");
    button.type = "button";
    button.textContent = String(index + 1).padStart(2, "0");
    button.className = isComplete ? "complete" : "";
    button.classList.toggle("active", index === state.activeExampleIndex);
    button.setAttribute("aria-label", `Open example ${index + 1}${isComplete ? ", complete" : ", incomplete"}`);
    if (index === state.activeExampleIndex) button.setAttribute("aria-current", "step");
    button.addEventListener("click", () => selectExample(index));
    navigation.appendChild(button);
  });
}

function selectExample(index, { focus = false } = {}) {
  state.activeExampleIndex = index;
  renderExampleStudio();
  if (focus) {
    const row = byId("examples-list").children[state.activeExampleIndex];
    row?.querySelector(".example-user")?.focus();
  }
}

function collectExamples() {
  return [...document.querySelectorAll(".example-row")].map((row) => ({
    user: row.querySelector(".example-user").value,
    assistant: row.querySelector(".example-assistant").value
  }));
}

byId("add-example").addEventListener("click", () => addExample({}, { select: true }));
byId("previous-example").addEventListener("click", () => selectExample(state.activeExampleIndex - 1));
byId("next-example").addEventListener("click", () => selectExample(state.activeExampleIndex + 1));
byId("fork-name").addEventListener("input", () => {
  setText("lineage-fork-name", byId("fork-name").value || "Untitled fork");
});
for (let index = 0; index < 5; index += 1) addExample();

async function refreshWorkspace() {
  if (!state.workspace) return;
  const { workspace } = await api(`/api/workspaces/${state.workspace.id}`);
  state.workspace = workspace;
  renderAll();
}

async function refreshFineTune() {
  if (!state.workspace) return;
  const { workspace } = await api(`/api/workspaces/${state.workspace.id}/fine-tune/status`);
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
  const examples = collectExamples();
  const incompleteIndex = examples.findIndex((example) => (
    !example.user.trim() || !example.assistant.trim()
  ));
  if (incompleteIndex !== -1) {
    selectExample(incompleteIndex);
    const row = byId("examples-list").children[incompleteIndex];
    const field = examples[incompleteIndex].user.trim()
      ? row.querySelector(".example-assistant")
      : row.querySelector(".example-user");
    showNotice(`Complete both messages in example ${incompleteIndex + 1}.`);
    field.focus();
    return;
  }
  const request = api(`/api/workspaces/${state.workspace.id}/fine-tune`, {
    method: "POST",
    body: JSON.stringify({
      name: byId("adapt-name").value,
      objective: byId("adapt-objective").value,
      examples
    })
  });
  state.workspace.fineTune = {
    id: "submitting",
    name: byId("adapt-name").value,
    objective: byId("adapt-objective").value,
    examples,
    exampleCount: examples.length,
    status: "preparing",
    provider: state.runtime.provider
  };
  renderAll();
  const submissionPoll = setInterval(async () => {
    try {
      const { workspace } = await api(`/api/workspaces/${state.workspace.id}`);
      if (fineTuneOf(workspace)) {
        state.workspace = workspace;
        renderAll();
      }
    } catch {}
  }, 500);
  try {
    const { workspace } = await request;
    state.workspace = workspace;
    state.runSelection = state.runtime.realExecution ? "base" : "fine-tuned";
    resetPlayground("Start a state to open the playground.");
    renderAll();
    if (["complete", "simulated"].includes(fineTuneOf(workspace)?.status)) openStage("run");
  } catch (error) {
    showNotice(error.message);
    if (error.payload?.workspace) state.workspace = error.payload.workspace;
    else await refreshWorkspace().catch(() => {});
    renderAll();
  } finally {
    clearInterval(submissionPoll);
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
      label: state.runSelection === "fine-tuned"
        ? fineTuneOf(state.workspace).name
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
    if (latest?.fineTune && ["queued", "training", "publishing"].includes(latest.fineTune.status)) {
      const status = await api(`/api/workspaces/${latest.id}/fine-tune/status`);
      latest = status.workspace;
    }
    if (latest?.run && ["starting", "running"].includes(latest.run.status)) {
      const status = await api(`/api/workspaces/${latest.id}/run/status`);
      latest = status.workspace;
    }

    if (latest) {
      state.workspace = latest;
      state.model = models.find((model) => model.id === latest.baseModel.id) || null;
      state.runSelection = latest.run?.modelState?.kind || (fineTuneOf(latest) ? "fine-tuned" : "base");
      if (!state.runtime.supportsAdaptedState) state.runSelection = "base";
    }

    renderAll();
    if (latest?.run || fineTuneOf(latest)) openStage("run");
    else if (latest) openStage("adapt");
    else openStage("choose");
  } catch (error) {
    showNotice(error.message);
  }
}

loadApp();
