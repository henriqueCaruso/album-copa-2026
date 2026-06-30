import { normalizeStickerId, normalizeOwnedCount } from "./stickerValidation";

export type ProgressSource = "firestore" | "local_v2" | "legacy_owned" | "legacy_repeated" | "missing_from_photos" | "memory";

export type ProgressSnapshot = {
  source: ProgressSource;
  counts: Record<string, number>;
  collectedAt: string;
  isAuthoritative: boolean;
};

export type RecoveryPreview = {
  counts: Record<string, number>;
  invalidIds: string[];
  totalUnique: number;
  totalRepeated: number;
  totalExtra: number;
  docsCreated: number;
  docsUpdated: number;
  docsUnchanged: number;
};

export function mergeProgressSnapshots(
  firestore: Record<string, number>,
  localV2: Record<string, number>,
  legacyOwned: Record<string, number>,
  legacyRepeated: Record<string, number>
): Record<string, number> {
  const merged: Record<string, number> = {};
  
  const sources = [firestore, localV2, legacyOwned, legacyRepeated];
  
  sources.forEach(source => {
    Object.entries(source).forEach(([id, count]) => {
      const validId = normalizeStickerId(id);
      if (validId) {
        const validCount = normalizeOwnedCount(count);
        merged[validId] = Math.max(merged[validId] || 0, validCount);
      }
    });
  });

  return merged;
}

export function buildRecoveryPreview(
  currentFirestore: Record<string, number>,
  mergedCounts: Record<string, number>
): RecoveryPreview {
  const invalidIds: string[] = [];
  let totalUnique = 0;
  let totalRepeated = 0;
  let totalExtra = 0;
  let docsCreated = 0;
  let docsUpdated = 0;
  let docsUnchanged = 0;

  Object.entries(mergedCounts).forEach(([id, proposedCount]) => {
    const validId = normalizeStickerId(id);
    if (!validId) {
      invalidIds.push(id);
      return;
    }

    if (proposedCount >= 1) totalUnique++;
    if (proposedCount >= 2) totalRepeated++;
    if (proposedCount > 1) totalExtra += (proposedCount - 1);

    const currentCount = currentFirestore[validId] || 0;
    
    if (currentCount === 0 && proposedCount > 0) {
      docsCreated++;
    } else if (proposedCount > currentCount) {
      docsUpdated++;
    } else {
      docsUnchanged++;
    }
  });

  return {
    counts: mergedCounts,
    invalidIds,
    totalUnique,
    totalRepeated,
    totalExtra,
    docsCreated,
    docsUpdated,
    docsUnchanged
  };
}
