export type TaxonomyMode = "existing" | "hybrid" | "fresh";

export type LinkStatus =
  | "pending"
  | "reachable"
  | "restricted"
  | "missing"
  | "timeout"
  | "network-error"
  | "unsupported-scheme";

export type JobStatus = "idle" | "running" | "paused" | "needs-review" | "applying" | "completed" | "failed" | "cancelled";
export type RunMode = "organize" | "link-cleanup";

export interface Settings {
  aiBaseUrl: string;
  selectedModel: string;
  taxonomyMode: TaxonomyMode;
  linkTimeoutMs: number;
  linkConcurrency: number;
  confidenceThreshold: number;
  autoPlaceNewBookmarks: boolean;
  excludedDomains: string[];
  excludedFolderNames: string[];
}

export interface BookmarkRecord {
  id: string;
  parentId?: string;
  title: string;
  url?: string;
  index?: number;
  dateAdded?: number;
  dateGroupModified?: number;
  path: string[];
}

export interface BookmarkSnapshot {
  version: 1;
  createdAt: string;
  checksum: string;
  tree: chrome.bookmarks.BookmarkTreeNode[];
  records: BookmarkRecord[];
  settings: Settings;
}

export interface LinkCheckResult {
  bookmarkId: string;
  url: string;
  status: LinkStatus;
  httpStatus?: number;
  finalUrl?: string;
  error?: string;
  checkedAt: string;
}

export interface DuplicateGroup {
  normalizedUrl: string;
  bookmarkIds: string[];
}

export interface ProposedFolder {
  tempId: string;
  title: string;
  parentPath: string[];
}

export interface ProposedMove {
  bookmarkId: string;
  targetPath: string[];
  confidence: number;
  reason: string;
}

export interface CurationPlan {
  version: 1;
  generatedAt: string;
  taxonomyMode: TaxonomyMode;
  folders: ProposedFolder[];
  moves: ProposedMove[];
  brokenBookmarkIds: string[];
  duplicateGroups: DuplicateGroup[];
  warnings: string[];
}

export interface OperationLogEntry {
  type: "move" | "create-folder" | "remove-empty-folder";
  bookmarkId: string;
  fromParentId?: string;
  fromIndex?: number;
  toParentId?: string;
  title?: string;
  path?: string[];
}

export interface ActivityLogEntry {
  at: string;
  level: "info" | "warning" | "error";
  message: string;
}

export interface RunState {
  id: string;
  mode?: RunMode;
  status: JobStatus;
  startedAt?: string;
  updatedAt: string;
  message: string;
  progress: {
    current: number;
    total: number;
    phase: "idle" | "backup" | "links" | "ai" | "review" | "apply";
  };
  backupId?: string;
  planId?: string;
  error?: string;
  log?: ActivityLogEntry[];
  continuation?: "link-checks" | "ai-planning";
}

export type MessageRequest =
  | { type: "get-state" }
  | { type: "list-runs" }
  | { type: "start-scan" }
  | { type: "start-link-cleanup" }
  | { type: "pause-scan" }
  | { type: "resume-scan" }
  | { type: "resume-run"; runId: string }
  | { type: "cancel-scan" }
  | { type: "apply-plan" }
  | { type: "undo-last-run" }
  | { type: "download-backup" }
  | { type: "restore-backup"; backup: BookmarkSnapshot }
  | { type: "get-settings" }
  | { type: "save-settings"; settings: Settings }
  | { type: "list-models" }
  | { type: "test-ai-connection" }
  | { type: "get-current-plan" };

export type MessageResponse<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };
