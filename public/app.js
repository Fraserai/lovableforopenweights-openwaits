const state = {
  model: null,
  workspace: null,
  currentStage: "choose"
};

const stageOrder = ["choose", "fork", "adapt", "run"];
const notice = document.querySelector("#notice");

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
  document.querySelectorAll(".stage").forEach((element) => element.classList.remove("active-stage"));
  document.querySelector(`#${stage}`).classList.add("active-stage");
  document.querySelectorAll(".step").forEach((button) => {
    button.classList.toggle("active", button.dataset.stage === stage);
  });
}

function unlockThrough(stage) {
  const index = stageOrder.indexOf(stage);
  document.querySelectorAll(".step").forEach((button) => {
    button.disabled = stageOrder.indexOf(button.dataset.stage) > index;
  });
}

function renderModel(model) {
  const card = document.createElement("article");
  card.className = "model-card";
  card.innerHTML = `
    <div class="model-meta"><span>${model.publisher}</span><span>${model.kind}</span></div>
    <h3>${model.name}</h3>
    <p>${model.summary}</p>
    <div class="model-tags">
      <span>${model.license}</span><span>${model.modality}</span><span>LoRA supported</span>
    </div>
    <button class="primary">Choose ${model.name}</button>`;
  card.querySelector("button").addEventListener("click", () => {
    state.model = model;
    document.querySelector("#fork-source").innerHTML =
      `<strong>${model.name}</strong><br>Source: ${model.sourceUrl}<br>Licence: ${model.license}`;
    document.querySelector("#fork-name").value = `My ${model.name}`;
    unlockThrough("fork");
    openStage("fork");
  });
  return card;
}

async function loadModels() {
  try {
    const { models } = await api("/api/models");
    const list = document.querySelector("#model-list");
    list.innerHTML = "";
    models.forEach((model) => list.appendChild(renderModel(model)));
  } catch (error) {
    showNotice(error.message);
  }
}

function renderWorkspace() {
  const workspace = state.workspace;
  if (!workspace) return;

  document.querySelector("#lineage").innerHTML = `
    <strong>${workspace.name}</strong><br>
    Base: ${workspace.baseModel.name}<br>
    ${workspace.adaptation ? `Adaptation: ${workspace.adaptation.name} · ${workspace.adaptation.method.toUpperCase()}` : "No adaptation"}`;
  document.querySelector("#playground-title").textContent = workspace.name;

  const running = workspace.run?.status === "running";
  document.querySelector("#run-status").textContent = running ? "Running" : "Not running";
  document.querySelector("#run-dot").classList.toggle("running", running);
  document.querySelector("#endpoint").textContent = running
    ? `${window.location.origin}${workspace.run.endpoint}`
    : "Endpoint appears after run";

  const chatInput = document.querySelector("#chat-input");
  const chatButton = document.querySelector("#chat-form button");
  chatInput.disabled = !running;
  chatButton.disabled = !running;

  if (running && document.querySelector("#messages .empty-state")) {
    document.querySelector("#messages").innerHTML =
      `<p class="message assistant">Your fork is running through the mock compute adapter. Send a message to test the complete product loop.</p>`;
  }
}

document.querySelectorAll(".step").forEach((button) => {
  button.addEventListener("click", () => !button.disabled && openStage(button.dataset.stage));
});

document.querySelector("#fork-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  clearNotice();
  try {
    const payload = await api("/api/workspaces", {
      method: "POST",
      body: JSON.stringify({
        modelId: state.model.id,
        name: document.querySelector("#fork-name").value
      })
    });
    state.workspace = payload.workspace;
    unlockThrough("adapt");
    openStage("adapt");
  } catch (error) {
    showNotice(error.message);
  }
});

document.querySelector("#adapt-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  clearNotice();
  try {
    const payload = await api(`/api/workspaces/${state.workspace.id}/adapt`, {
      method: "POST",
      body: JSON.stringify({
        name: document.querySelector("#adapt-name").value,
        objective: document.querySelector("#adapt-objective").value
      })
    });
    state.workspace = payload.workspace;
    unlockThrough("run");
    renderWorkspace();
    openStage("run");
  } catch (error) {
    showNotice(error.message);
  }
});

document.querySelector("#run-button").addEventListener("click", async () => {
  clearNotice();
  const button = document.querySelector("#run-button");
  button.disabled = true;
  button.textContent = "Starting…";
  try {
    const payload = await api(`/api/workspaces/${state.workspace.id}/run`, {
      method: "POST",
      body: "{}"
    });
    state.workspace = payload.workspace;
    renderWorkspace();
    button.textContent = "Restart model";
  } catch (error) {
    showNotice(error.message);
    button.textContent = "Run model";
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#chat-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  clearNotice();
  const input = document.querySelector("#chat-input");
  const message = input.value.trim();
  if (!message) return;
  input.value = "";
  appendMessage("user", message);
  try {
    const payload = await api(`/api/workspaces/${state.workspace.id}/chat`, {
      method: "POST",
      body: JSON.stringify({ message })
    });
    appendMessage("assistant", payload.message.content);
  } catch (error) {
    showNotice(error.message);
  }
});

function appendMessage(role, content) {
  const messages = document.querySelector("#messages");
  messages.querySelector(".empty-state")?.remove();
  const element = document.createElement("p");
  element.className = `message ${role}`;
  element.textContent = content;
  messages.appendChild(element);
  messages.scrollTop = messages.scrollHeight;
}

loadModels();
