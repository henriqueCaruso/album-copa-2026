import { normalizeStickerId, normalizeOwnedCount } from "./stickerValidation";

export type ProgressSource = "firestore" | "local_v2" | "legacy_owned" | "legacy_repeated" | "missing_from_photos" | "memory";

export type ProgressSnapshot = {
  source: ProgressSource;
  counts: Record<string, number>;
  collectedAt: string;
  isAuthoritative: boolean;
};

export type InvalidIdInfo = {
  id: string;
  source: ProgressSource;
  rawCount: unknown;
};

export type MergeProgressResult = {
  counts: Record<string, number>;
  invalidIds: InvalidIdInfo[];
};

export type RecoveryPreview = {
  counts: Record<string, number>;
  invalidIds: InvalidIdInfo[];
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
): MergeProgressResult {
  const merged: Record<string, number> = {};
  const invalidIds: InvalidIdInfo[] = [];
  
  const sources: { name: ProgressSource; data: Record<string, number> }[] = [
    { name: "firestore", data: firestore },
    { name: "local_v2", data: localV2 },
    { name: "legacy_owned", data: legacyOwned },
    { name: "legacy_repeated", data: legacyRepeated }
  ];
  
  sources.forEach(source => {
    Object.entries(source.data).forEach(([id, count]) => {
      const validId = normalizeStickerId(id);
      if (validId) {
        const validCount = normalizeOwnedCount(count);
        merged[validId] = Math.max(merged[validId] || 0, validCount);
      } else {
        invalidIds.push({ id, source: source.name, rawCount: count });
      }
    });
  });

  return { counts: merged, invalidIds };
}

export function buildRecoveryPreview(
  currentFirestore: Record<string, number>,
  mergeResult: MergeProgressResult
): RecoveryPreview {
  let totalUnique = 0;
  let totalRepeated = 0;
  let totalExtra = 0;
  let docsCreated = 0;
  let docsUpdated = 0;
  let docsUnchanged = 0;

  Object.entries(mergeResult.counts).forEach(([id, proposedCount]) => {
    if (proposedCount >= 1) totalUnique++;
    if (proposedCount >= 2) totalRepeated++;
    if (proposedCount > 1) totalExtra += (proposedCount - 1);

    const currentCount = currentFirestore[id] || 0;
    
    if (currentCount === 0 && proposedCount > 0) {
      docsCreated++;
    } else if (proposedCount > currentCount) {
      docsUpdated++;
    } else {
      docsUnchanged++;
    }
  });

  return {
    counts: mergeResult.counts,
    invalidIds: mergeResult.invalidIds,
    totalUnique,
    totalRepeated,
    totalExtra,
    docsCreated,
    docsUpdated,
    docsUnchanged
  };
}
