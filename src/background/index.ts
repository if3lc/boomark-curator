import { NEEDS_REVIEW_FOLDER } from "../shared/defaults";
import type { MessageRequest, MessageResponse, ProposedMove } from "../shared/types";
import { flattenBookmarkTree, getBookmarkLeaves, pathToLabel } from "../shared/bookmarks";
import { listModels } from "./aiClient";
import { createBookmark, getBookmarkTree, moveBookmark } from "./chromeApi";
import { applyCurrentPlan, cancelScan, currentState, downloadLatestBackup, pauseScan, restoreBackup, resumeScan, startScan, undoLastRun } from "./job";
import { loadSettings, saveSettings } from "./settings";
import { getPlan } from "./db";

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.runtime.onMessage.addListener((request: MessageRequest, _sender, sendResponse: (response: MessageResponse) => void) => {
  handleMessage(request)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  return true;
});

chrome.bookmarks.onCreated.addListener((id, node) => {
  void autoPlaceBookmark(id, node).catch((error) => {
    console.warn("Bookmark Curator auto-placement failed", error);
  });
});

async function handleMessage(request: MessageRequest): Promise<unknown> {
  switch (request.type) {
    case "get-state":
      return currentState();
    case "start-scan":
      return startScan();
    case "pause-scan":
      return pauseScan();
    case "resume-scan":
      return resumeScan();
    case "cancel-scan":
      return cancelScan();
    case "apply-plan":
      return applyCurrentPlan();
    case "undo-last-run":
      return undoLastRun();
    case "download-backup":
      return downloadLatestBackup();
    case "restore-backup":
      return restoreBackup(request.backup);
    case "get-settings":
      return loadSettings();
    case "save-settings":
      return saveSettings(request.settings);
    case "list-models":
      return listModels(await loadSettings());
    case "test-ai-connection":
      return { models: await listModels(await loadSettings()) };
    case "get-current-plan": {
      const state = await currentState();
      return state.planId ? getPlan(state.planId) : undefined;
    }
  }
}

async function autoPlaceBookmark(id: string, node: chrome.bookmarks.BookmarkTreeNode): Promise<void> {
  const settings = await loadSettings();
  if (!settings.autoPlaceNewBookmarks || !node.url || !settings.selectedModel) return;

  const tree = await getBookmarkTree();
  const records = flattenBookmarkTree(tree);
  const folders = records.filter((record) => !record.url && record.path.length > 0).map((record) => pathToLabel(record.path));
  const page = await fetchPageSummary(node.url);

  const response = await fetch(`${settings.aiBaseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: settings.selectedModel,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "Return JSON only: {\"targetPath\":[\"Bookmarks Bar\",\"Folder\"],\"confidence\":0.8,\"reason\":\"short\"}." },
        {
          role: "user",
          content: JSON.stringify({
            bookmark: { id, title: node.title, url: node.url, page },
            existingFolders: folders,
            rule: "Choose one existing folder when possible. Use Bookmark Curator / Needs Review if uncertain."
          })
        }
      ]
    })
  });

  if (!response.ok) return;
  const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = body.choices?.[0]?.message?.content;
  if (!content) return;
  const move = JSON.parse(content) as ProposedMove;
  const targetPath = Array.isArray(move.targetPath) && move.confidence >= settings.confidenceThreshold ? move.targetPath : ["Bookmark Curator", NEEDS_REVIEW_FOLDER];
  const target = await ensureFolder(targetPath);
  await moveBookmark(id, { parentId: target.id });
}

async function fetchPageSummary(url: string): Promise<string> {
  try {
    const response = await fetch(url, { method: "GET", redirect: "follow" });
    const html = await response.text();
    const title = html.match(/<title[^>]*>(.*?)<\/title>/is)?.[1] ?? "";
    const description = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1] ?? "";
    return `${stripHtml(title)} ${stripHtml(description)}`.trim().slice(0, 1200);
  } catch {
    return "";
  }
}

async function ensureFolder(path: string[]): Promise<chrome.bookmarks.BookmarkTreeNode> {
  const tree = await getBookmarkTree();
  let parentId = "1";
  let siblings = tree[0]?.children ?? [];
  let current: chrome.bookmarks.BookmarkTreeNode | undefined;

  for (const title of path) {
    current = siblings.find((candidate) => candidate.title === title && !candidate.url);
    if (!current) {
      current = await createBookmark({ parentId, title });
    }
    parentId = current.id;
    siblings = current.children ?? [];
  }
  if (!current) throw new Error("Cannot create an empty folder path.");
  return current;
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
