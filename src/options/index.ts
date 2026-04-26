import "../ui/styles.css";
import type { Settings } from "../shared/types";
import { DEFAULT_SETTINGS } from "../shared/defaults";
import { sendMessage } from "../ui/message";

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) throw new Error("Missing app root");
const app: HTMLDivElement = root;

let settings: Settings = DEFAULT_SETTINGS;
let models: Array<{ id: string; owned_by?: string }> = [];
let message = "";

void init();

async function init(): Promise<void> {
  settings = await sendMessage<Settings>({ type: "get-settings" });
  await loadModels();
  render();
}

async function loadModels(): Promise<void> {
  try {
    models = await sendMessage<Array<{ id: string; owned_by?: string }>>({ type: "list-models" });
    if (!settings.selectedModel && models[0]) {
      settings = { ...settings, selectedModel: models[0].id };
    }
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
}

function readSettings(): Settings {
  return {
    aiBaseUrl: value("aiBaseUrl"),
    selectedModel: value("selectedModel"),
    taxonomyMode: value("taxonomyMode") as Settings["taxonomyMode"],
    linkTimeoutMs: Number(value("linkTimeoutMs")),
    linkConcurrency: Number(value("linkConcurrency")),
    confidenceThreshold: Number(value("confidenceThreshold")),
    autoPlaceNewBookmarks: (document.querySelector<HTMLInputElement>("#autoPlaceNewBookmarks")?.checked ?? true),
    excludedDomains: splitLines(value("excludedDomains")),
    excludedFolderNames: splitLines(value("excludedFolderNames"))
  };
}

function render(): void {
  app.innerHTML = `
    <section class="shell">
      <header class="topbar">
        <h1>Bookmark Curator Settings</h1>
        <p>Configure the local AI model and cleanup behavior.</p>
      </header>
      <form class="content" id="settingsForm">
        ${message ? `<article class="card">${escapeHtml(message)}</article>` : ""}
        <article class="card stack">
          <h2>AI Provider</h2>
          <label>Base URL
            <input id="aiBaseUrl" value="${escapeAttr(settings.aiBaseUrl)}" />
          </label>
          <div class="row">
            <label style="flex:1">Model
              <select id="selectedModel">
                ${models.map((model) => `<option value="${escapeAttr(model.id)}" ${model.id === settings.selectedModel ? "selected" : ""}>${escapeHtml(model.id)}</option>`).join("")}
              </select>
            </label>
            <button type="button" data-action="refresh-models">Refresh</button>
          </div>
          <button type="button" data-action="test">Test connection</button>
        </article>
        <article class="card stack">
          <h2>Organization</h2>
          <label>Taxonomy mode
            <select id="taxonomyMode">
              <option value="existing" ${settings.taxonomyMode === "existing" ? "selected" : ""}>Existing folders only</option>
              <option value="hybrid" ${settings.taxonomyMode === "hybrid" ? "selected" : ""}>Hybrid</option>
              <option value="fresh" ${settings.taxonomyMode === "fresh" ? "selected" : ""}>Fresh taxonomy</option>
            </select>
          </label>
          <label>Confidence threshold
            <input id="confidenceThreshold" type="number" min="0" max="1" step="0.01" value="${settings.confidenceThreshold}" />
          </label>
          <label class="row">
            <span>Auto-place new bookmarks</span>
            <input id="autoPlaceNewBookmarks" type="checkbox" ${settings.autoPlaceNewBookmarks ? "checked" : ""} style="width:auto" />
          </label>
        </article>
        <article class="card stack">
          <h2>Link Checks</h2>
          <label>Timeout in milliseconds
            <input id="linkTimeoutMs" type="number" min="1000" step="500" value="${settings.linkTimeoutMs}" />
          </label>
          <label>Concurrency
            <input id="linkConcurrency" type="number" min="1" max="12" value="${settings.linkConcurrency}" />
          </label>
        </article>
        <article class="card stack">
          <h2>Exclusions</h2>
          <label>Excluded domains
            <textarea id="excludedDomains">${escapeHtml(settings.excludedDomains.join("\n"))}</textarea>
          </label>
          <label>Excluded folder names
            <textarea id="excludedFolderNames">${escapeHtml(settings.excludedFolderNames.join("\n"))}</textarea>
          </label>
        </article>
        <div class="buttons">
          <button class="primary" type="submit">Save settings</button>
        </div>
      </form>
    </section>
  `;

  app.querySelector("#settingsForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    void save();
  });
  app.querySelector('[data-action="refresh-models"]')?.addEventListener("click", () => void refreshModels());
  app.querySelector('[data-action="test"]')?.addEventListener("click", () => void testConnection());
}

async function save(): Promise<void> {
  settings = await sendMessage<Settings>({ type: "save-settings", settings: readSettings() });
  message = "Settings saved.";
  render();
}

async function refreshModels(): Promise<void> {
  settings = readSettings();
  await sendMessage<Settings>({ type: "save-settings", settings });
  await loadModels();
  message = `Loaded ${models.length} models.`;
  render();
}

async function testConnection(): Promise<void> {
  settings = await sendMessage<Settings>({ type: "save-settings", settings: readSettings() });
  const result = await sendMessage<{ models: unknown[] }>({ type: "test-ai-connection" });
  message = `Connection OK. ${result.models.length} models available.`;
  render();
}

function value(id: string): string {
  return document.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`#${id}`)?.value.trim() ?? "";
}

function splitLines(value: string): string[] {
  return value
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char] ?? char);
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/`/g, "&#096;");
}
