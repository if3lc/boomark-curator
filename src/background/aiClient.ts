import { CurationPlanSchema } from "../shared/validation";
import type { BookmarkRecord, CurationPlan, DuplicateGroup, LinkCheckResult, Settings } from "../shared/types";
import { pathToLabel } from "../shared/bookmarks";

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
      currentPath: pathToLabel(record.path)
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
              folders: [{ tempId: "string", title: "string", parentPath: ["Bookmarks Bar"] }],
              moves: [{ bookmarkId: "string", targetPath: ["Bookmarks Bar", "Folder"], confidence: 0.9, reason: "short reason" }],
              brokenBookmarkIds: [...brokenIds],
              duplicateGroups,
              warnings: []
            },
            taxonomyMode: settings.taxonomyMode,
            rules: [
              "Only use bookmarkId values from candidates.",
              "For existing mode, targetPath must use folders already present in currentPath values.",
              "For hybrid mode, preserve useful existing folders and add new folders only when helpful.",
              "For fresh mode, create a clean taxonomy.",
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

  const parsed = JSON.parse(content) as unknown;
  const plan = CurationPlanSchema.parse(parsed);
  const validIds = new Set(records.map((record) => record.id));
  const existingPaths = new Set(records.map((record) => pathToLabel(record.path)));

  return {
    ...plan,
    brokenBookmarkIds: [...new Set([...plan.brokenBookmarkIds, ...brokenIds])],
    duplicateGroups,
    moves: plan.moves.filter((move) => validIds.has(move.bookmarkId) && move.confidence >= settings.confidenceThreshold),
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
