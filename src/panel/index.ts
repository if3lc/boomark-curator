import "../ui/styles.css";
import type { CurationPlan, RunState } from "../shared/types";
import { sendMessage } from "../ui/message";

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) throw new Error("Missing app root");
const app: HTMLDivElement = root;

let state: RunState | undefined;
let plan: CurationPlan | undefined;
let runs: RunState[] = [];
let error = "";

render();
void refresh();
setInterval(() => void refresh(false), 2500);

async function refresh(showError = true): Promise<void> {
  try {
    state = await sendMessage<RunState>({ type: "get-state" });
    plan = await sendMessage<CurationPlan | undefined>({ type: "get-current-plan" });
    runs = await sendMessage<RunState[]>({ type: "list-runs" });
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
            <button data-action="pause" ${state?.status === "running" ? "" : "disabled"}>Pause</button>
            <button data-action="resume" ${state?.status === "paused" || state?.status === "failed" || state?.status === "cancelled" ? "" : "disabled"}>Resume current</button>
            <button data-action="backup" ${state?.backupId ? "" : "disabled"}>Download backup</button>
            <button data-action="restore">Restore backup file</button>
            <button data-action="undo">Undo last run</button>
            <button class="danger" data-action="cancel">Cancel</button>
          </div>
          <input id="restoreFile" type="file" accept="application/json" hidden />
        </article>
        <article class="card stack">
          <h2>Interrupted Run</h2>
          ${renderRuns(runs)}
        </article>
        <article class="card stack">
          <h2>Activity Log</h2>
          ${renderLog(state)}
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
  app.querySelector('[data-action="pause"]')?.addEventListener("click", () => void action({ type: "pause-scan" }));
  app.querySelector('[data-action="resume"]')?.addEventListener("click", () => void action({ type: "resume-scan" }));
  app.querySelector('[data-action="backup"]')?.addEventListener("click", () => void action({ type: "download-backup" }));
  app.querySelector('[data-action="restore"]')?.addEventListener("click", () => app.querySelector<HTMLInputElement>("#restoreFile")?.click());
  app.querySelector('[data-action="undo"]')?.addEventListener("click", () => void action({ type: "undo-last-run" }));
  app.querySelector('[data-action="cancel"]')?.addEventListener("click", () => void action({ type: "cancel-scan" }));
  app.querySelector('[data-action="apply"]')?.addEventListener("click", () => void action({ type: "apply-plan" }));
  app.querySelector('[data-action="options"]')?.addEventListener("click", () => chrome.runtime.openOptionsPage());
  app.querySelectorAll<HTMLButtonElement>("[data-resume-run]").forEach((button) => {
    button.addEventListener("click", () => void action({ type: "resume-run", runId: button.dataset.resumeRun ?? "" }));
  });
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

function renderRuns(nextRuns: RunState[]): string {
  const interrupted = nextRuns.filter((run) => run.status !== "running" || run.id !== state?.id).slice(0, 8);
  if (!interrupted.length) {
    return `<p class="muted">No paused, failed, or cancelled run with saved progress.</p>`;
  }

  return `
    <div class="list">
      ${interrupted
        .map((run) => {
          const percent = run.progress.total ? Math.round((run.progress.current / run.progress.total) * 100) : 0;
          return `
            <div class="list-item stack">
              <div class="row">
                <strong>${escapeHtml(run.progress.phase)} · ${percent}%</strong>
                <span class="pill">${escapeHtml(run.status)}</span>
              </div>
              <p class="muted">${escapeHtml(run.message)}</p>
              <div class="row muted">
                <span>${new Date(run.updatedAt).toLocaleString()}</span>
                <span>${run.progress.current} / ${run.progress.total}</span>
              </div>
              <button data-resume-run="${escapeAttr(run.id)}">Resume this run</button>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderLog(nextState: RunState | undefined): string {
  const entries = [...(nextState?.log ?? [])].reverse().slice(0, 80);
  if (!entries.length) {
    return `<p class="muted">No activity yet.</p>`;
  }

  return `
    <div class="list log-list">
      ${entries
        .map(
          (entry) => `
            <div class="log-item ${escapeAttr(entry.level)}">
              <span class="muted">${new Date(entry.at).toLocaleTimeString()}</span>
              <span>${escapeHtml(entry.message)}</span>
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

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/`/g, "&#096;");
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
