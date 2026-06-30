import { totalAlbumStickers, missingFromPhotos } from "../data";

export type LocalAlbumSnapshot = {
  counts: Record<string, number>;
  capturedAt: number;
  sourceVersion: number;
};

export function readLocalAlbumSnapshot(): LocalAlbumSnapshot | null {
  try {
    const v2Data = localStorage.getItem("copa2026_album_v2");
    if (v2Data) {
      const parsed = JSON.parse(v2Data);
      if (parsed.counts) {
        return {
          counts: parsed.counts,
          capturedAt: parsed.updatedAt || Date.now(),
          sourceVersion: parsed.schemaVersion || 2
        };
      }
    }

    const savedOwned = localStorage.getItem("copa2026_owned");
    const savedRepeated = localStorage.getItem("copa2026_repeated");

    if (savedOwned || savedRepeated) {
      const counts: Record<string, number> = {};
      
      if (savedOwned) {
        const ownedArr: string[] = JSON.parse(savedOwned);
        ownedArr.forEach((id) => {
          counts[id] = 1;
        });
      }
      
      if (savedRepeated) {
        const repeatedArr: string[] = JSON.parse(savedRepeated);
        repeatedArr.forEach((id) => {
          counts[id] = 2; // Old model: max 2
        });
      }

      return {
        counts,
        capturedAt: Date.now(),
        sourceVersion: 1
      };
    }
  } catch (e) {
    console.error("Failed to read local snapshot", e);
  }

  return null;
}

export function saveLocalAlbumSnapshot(counts: Record<string, number>) {
  try {
    const data = {
      schemaVersion: 2,
      updatedAt: Date.now(),
      counts
    };
    localStorage.setItem("copa2026_album_v2", JSON.stringify(data));
    
    // For backward compatibility during migration, we also save v1
    const nextOwned = Object.keys(counts).filter((id) => counts[id] >= 1);
    const nextRepeated = Object.keys(counts).filter((id) => counts[id] >= 2);
    localStorage.setItem("copa2026_owned", JSON.stringify(nextOwned));
    localStorage.setItem("copa2026_repeated", JSON.stringify(nextRepeated));
  } catch (e) {
    console.error("Failed to save local snapshot", e);
  }
}

export function hasMeaningfulLocalProgress(snapshot: LocalAlbumSnapshot | null): boolean {
  if (!snapshot) return false;
  return Object.keys(snapshot.counts).length > 0;
}

// Selectors
export function getOwnedUniqueCount(counts: Record<string, number>): number {
  return Object.keys(counts).filter(id => counts[id] >= 1).length;
}

export function getRepeatedUniqueCount(counts: Record<string, number>): number {
  return Object.keys(counts).filter(id => counts[id] >= 2).length;
}

export function getExtraCopiesCount(counts: Record<string, number>): number {
  return Object.values(counts).reduce((acc, count) => acc + Math.max(0, count - 1), 0);
}

export function getTotalPhysicalCopies(counts: Record<string, number>): number {
  return Object.values(counts).reduce((acc, count) => acc + count, 0);
}

export function getProgressPercent(counts: Record<string, number>): number {
  const ownedCount = getOwnedUniqueCount(counts);
  return Math.round((ownedCount / totalAlbumStickers.length) * 100);
}
