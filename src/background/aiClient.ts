import { CurationPlanSchema } from "../shared/validation";
import type { BookmarkRecord, CurationPlan, DuplicateGroup, LinkCheckResult, Settings } from "../shared/types";
import { pathToLabel } from "../shared/bookmarks";
import { getDomain } from "../shared/url";
import { CURATOR_ROOT_FOLDER, FRESH_TAXONOMY_FOLDER } from "../shared/defaults";

export interface ModelInfo {
  id: string;
  object?: string;
  owned_by?: string;
}

export async function listModels(settings: Settings): Promise<ModelInfo[]> {
  const response = await fetch(`${settings.aiBaseUrl.replace(/\/$/, "")}/models`);
  if (!response.ok) {
    throw new Error(`Model request failed with ${response.status}`);
  }
  const body = (await response.json()) as { data?: ModelInfo[] };
  return body.data ?? [];
}

export async function createCurationPlan(input: {
  records: BookmarkRecord[];
  linkResults: LinkCheckResult[];
  duplicateGroups: DuplicateGroup[];
  settings: Settings;
}): Promise<CurationPlan> {
  const { records, linkResults, duplicateGroups, settings } = input;
  const model = settings.selectedModel || (await listModels(settings))[0]?.id;
  if (!model) {
    throw new Error("No model selected and no models were returned by the endpoint.");
  }

  const brokenIds = new Set(
    linkResults
      .filter((result) => result.status === "missing" || result.status === "timeout" || result.status === "network-error" || result.status === "unsupported-scheme")
      .map((result) => result.bookmarkId)
  );

  const candidates = records
    .filter((record) => record.url && !brokenIds.has(record.id))
    .slice(0, 1200)
    .map((record) => ({
      id: record.id,
      title: record.title,
      url: record.url,
      domain: record.url ? getDomain(record.url) : "",
      ...(settings.taxonomyMode === "fresh" ? {} : { currentPath: pathToLabel(record.path) })
    }));

  const response = await fetch(`${settings.aiBaseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You organize browser bookmarks. Return strict JSON only. Never propose deleting bookmarks. Use concise English folder names."
        },
        {
          role: "user",
          content: JSON.stringify({
            requiredSchema: {
              version: 1,
              generatedAt: "ISO datetime",
              taxonomyMode: settings.taxonomyMode,
              folders: [{ tempId: "string", title: "string", parentPath: settings.taxonomyMode === "fresh" ? [CURATOR_ROOT_FOLDER, FRESH_TAXONOMY_FOLDER] : ["Bookmarks Bar"] }],
              moves: [{ bookmarkId: "string", targetPath: settings.taxonomyMode === "fresh" ? [CURATOR_ROOT_FOLDER, FRESH_TAXONOMY_FOLDER, "Folder"] : ["Bookmarks Bar", "Folder"], confidence: 0.9, reason: "short reason" }],
              brokenBookmarkIds: [...brokenIds],
              duplicateGroups,
              warnings: []
            },
            taxonomyMode: settings.taxonomyMode,
            rules: [
              "Only use bookmarkId values from candidates.",
              "For existing mode, targetPath must use folders already present in currentPath values.",
              "For hybrid mode, preserve useful existing folders and add new folders only when helpful.",
              "For fresh mode, ignore all existing folder/category structure. Create a clean taxonomy using only title, URL, and domain patterns.",
              "For fresh mode, do not infer folder names from any previous currentPath because currentPath is intentionally omitted.",
              `For fresh mode, every targetPath must start with "${CURATOR_ROOT_FOLDER}" then "${FRESH_TAXONOMY_FOLDER}".`,
              "Do not include broken bookmarks in moves."
            ],
            candidates,
            duplicateGroups,
            brokenBookmarkIds: [...brokenIds]
          })
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`AI request failed with ${response.status}`);
  }

  const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = body.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("AI response did not include message content.");
  }

  const parsed = withPlanDefaults(JSON.parse(content) as Record<string, unknown>, settings);
  const plan = CurationPlanSchema.parse(parsed);
  const validIds = new Set(records.map((record) => record.id));
  const existingPaths = new Set(records.map((record) => pathToLabel(record.path)));

  return {
    ...plan,
    brokenBookmarkIds: [...new Set([...plan.brokenBookmarkIds, ...brokenIds])],
    duplicateGroups,
    moves: plan.moves
      .filter((move) => validIds.has(move.bookmarkId) && move.confidence >= settings.confidenceThreshold)
      .map((move) => ({
        ...move,
        targetPath: settings.taxonomyMode === "fresh" ? ensureFreshPath(move.targetPath) : move.targetPath
      })),
    warnings: [
      ...plan.warnings,
      ...(settings.taxonomyMode === "existing"
        ? plan.moves
            .filter((move) => !existingPaths.has(pathToLabel(move.targetPath)))
            .map((move) => `Ignored move for ${move.bookmarkId}: target path is not an existing folder.`)
        : [])
    ]
  };
}

function ensureFreshPath(path: string[]): string[] {
  const clean = path.filter(Boolean);
  if (clean[0] === CURATOR_ROOT_FOLDER && clean[1] === FRESH_TAXONOMY_FOLDER) {
    return clean;
  }
  const withoutReservedPrefix = clean.filter((part) => part !== CURATOR_ROOT_FOLDER && part !== FRESH_TAXONOMY_FOLDER);
  return [CURATOR_ROOT_FOLDER, FRESH_TAXONOMY_FOLDER, ...withoutReservedPrefix];
}

function withPlanDefaults(value: Record<string, unknown>, settings: Settings): Record<string, unknown> {
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    taxonomyMode: settings.taxonomyMode,
    folders: [],
    moves: [],
    brokenBookmarkIds: [],
    duplicateGroups: [],
    warnings: [],
    ...value
  };
}
