import type { RunState, Settings } from "./types";

export const DEFAULT_SETTINGS: Settings = {
  aiBaseUrl: "http://localhost:8317/v1",
  selectedModel: "",
  taxonomyMode: "hybrid",
  linkTimeoutMs: 5000,
  linkConcurrency: 4,
  confidenceThreshold: 0.78,
  autoPlaceNewBookmarks: true,
  excludedDomains: [],
  excludedFolderNames: ["Bookmarks Bar"]
};

export const IDLE_STATE: RunState = {
  id: "idle",
  status: "idle",
  updatedAt: new Date(0).toISOString(),
  message: "Ready",
  progress: {
    current: 0,
    total: 0,
    phase: "idle"
  }
};

export const CURATOR_ROOT_FOLDER = "Bookmark Curator";
export const BROKEN_FOLDER = "Broken Links";
export const DUPLICATE_FOLDER = "Duplicates";
export const NEEDS_REVIEW_FOLDER = "Needs Review";
export const FRESH_TAXONOMY_FOLDER = "Fresh Taxonomy";
export const LINK_CHECK_BATCH_SIZE = 50;
export const LINK_CHECK_ALARM = "bookmark-curator-continue-link-checks";
