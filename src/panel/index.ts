import "../ui/styles.css";
import type { CurationPlan, RunState } from "../shared/types";
import { sendMessage } from "../ui/message";

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) throw new Error("Missing app root");
const app: HTMLDivElement = root;

let state: RunState | undefined;
let plan: CurationPlan | undefined;
let error = "";

render();
void refresh();
setInterval(() => void refresh(false), 2500);

async function refresh(showError = true): Promise<void> {
  try {
    state = await sendMessage<RunState>({ type: "get-state" });
    plan = await sendMessage<CurationPlan | undefined>({ type: "get-current-plan" });
    error = "";
  } catch (err) {
    if (showError) error = err instanceof Error ? err.message : String(err);
  }
  render();
}

async function action<T>(request: Parameters<typeof sendMessage<T>>[0]): Promise<void> {
  try {
    error = "";
    await sendMessage<T>(request);
    await refresh();
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    render();
  }
}

function render(): void {
  const progressValue = state?.progress.total ? Math.round((state.progress.current / state.progress.total) * 100) : 0;
  const canApply = state?.status === "needs-review" && Boolean(plan);

  app.innerHTML = `
    <section class="shell">
      <header class="topbar">
        <h1>Bookmark Curator</h1>
        <p>Back up, check, and reorganize Chrome bookmarks with a local AI model.</p>
      </header>
      <section class="content">
        ${error ? `<div class="card"><strong>Error</strong><p>${escapeHtml(error)}</p></div>` : ""}
        <article class="card stack">
          <div class="row">
            <h2>Current Run</h2>
            <span class="pill">${escapeHtml(state?.status ?? "idle")}</span>
          </div>
          <p class="muted">${escapeHtml(state?.message ?? "Ready")}</p>
          <progress value="${progressValue}" max="100"></progress>
          <div class="row muted">
            <span>${escapeHtml(state?.progress.phase ?? "idle")}</span>
            <span>${state?.progress.current ?? 0} / ${state?.progress.total ?? 0}</span>
          </div>
          <div class="buttons">
            <button class="primary" data-action="start">Start scan</button>
            <button data-action="backup" ${state?.backupId ? "" : "disabled"}>Download backup</button>
            <button data-action="restore">Restore backup file</button>
            <button data-action="undo">Undo last run</button>
            <button class="danger" data-action="cancel">Cancel</button>
          </div>
          <input id="restoreFile" type="file" accept="application/json" hidden />
        </article>
        <article class="card stack">
          <div class="row">
            <h2>Review</h2>
            <button class="primary" data-action="apply" ${canApply ? "" : "disabled"}>Apply approved plan</button>
          </div>
          ${renderPlan(plan)}
        </article>
        <article class="card stack">
          <h2>Settings</h2>
          <p class="muted">Use the extension options page to choose the local model, taxonomy mode, and link-check policy.</p>
          <button data-action="options">Open settings</button>
        </article>
      </section>
    </section>
  `;

  app.querySelector('[data-action="start"]')?.addEventListener("click", () => void action({ type: "start-scan" }));
  app.querySelector('[data-action="backup"]')?.addEventListener("click", () => void action({ type: "download-backup" }));
  app.querySelector('[data-action="restore"]')?.addEventListener("click", () => app.querySelector<HTMLInputElement>("#restoreFile")?.click());
  app.querySelector('[data-action="undo"]')?.addEventListener("click", () => void action({ type: "undo-last-run" }));
  app.querySelector('[data-action="cancel"]')?.addEventListener("click", () => void action({ type: "cancel-scan" }));
  app.querySelector('[data-action="apply"]')?.addEventListener("click", () => void action({ type: "apply-plan" }));
  app.querySelector('[data-action="options"]')?.addEventListener("click", () => chrome.runtime.openOptionsPage());
  app.querySelector<HTMLInputElement>("#restoreFile")?.addEventListener("change", (event) => void restoreFromInput(event));
}

function renderPlan(nextPlan: CurationPlan | undefined): string {
  if (!nextPlan) return `<p class="muted">Run a scan to generate a reviewable plan.</p>`;
  return `
    <div class="stat-grid">
      <div class="stat"><strong>${nextPlan.moves.length}</strong><span>Moves</span></div>
      <div class="stat"><strong>${nextPlan.brokenBookmarkIds.length}</strong><span>Broken</span></div>
      <div class="stat"><strong>${nextPlan.duplicateGroups.length}</strong><span>Duplicate groups</span></div>
    </div>
    <div class="list">
      ${nextPlan.moves
        .slice(0, 30)
        .map(
          (move) => `
          <div class="list-item">
            <strong>${escapeHtml(move.targetPath.join(" / "))}</strong>
            <p class="muted">${escapeHtml(move.bookmarkId)} · ${Math.round(move.confidence * 100)}% · ${escapeHtml(move.reason)}</p>
          </div>
        `
        )
        .join("")}
    </div>
  `;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char] ?? char);
}

async function restoreFromInput(event: Event): Promise<void> {
  const input = event.currentTarget as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    const backup = JSON.parse(await file.text());
    await action({ type: "restore-backup", backup });
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    render();
  } finally {
    input.value = "";
  }
}
