import { z } from "zod";

export const CurationPlanSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string(),
  taxonomyMode: z.enum(["existing", "hybrid", "fresh"]),
  folders: z.array(
    z.object({
      tempId: z.string(),
      title: z.string().min(1),
      parentPath: z.array(z.string())
    })
  ),
  moves: z.array(
    z.object({
      bookmarkId: z.string(),
      targetPath: z.array(z.string().min(1)).min(1),
      confidence: z.number().min(0).max(1),
      reason: z.string()
    })
  ),
  brokenBookmarkIds: z.array(z.string()),
  duplicateGroups: z.array(
    z.object({
      normalizedUrl: z.string(),
      bookmarkIds: z.array(z.string()).min(2)
    })
  ),
  warnings: z.array(z.string())
});
