import { LocalAlbumSnapshot } from "../utils/albumUtils";

export function readLocalAlbumV2(): Record<string, number> {
  try {
    const v2Data = localStorage.getItem("copa2026_album_v2");
    if (v2Data) {
      const parsed = JSON.parse(v2Data);
      if (parsed.counts) {
        return parsed.counts;
      }
    }
  } catch (e) {
    console.warn("Failed to read copa2026_album_v2", e);
  }
  return {};
}

export function parseLegacyOwned(): Record<string, number> {
  try {
    const savedOwned = localStorage.getItem("copa2026_owned");
    if (savedOwned) {
      const ownedArr: string[] = JSON.parse(savedOwned);
      const counts: Record<string, number> = {};
      ownedArr.forEach((id) => {
        counts[id] = 1;
      });
      return counts;
    }
  } catch (e) {
    console.warn("Failed to read copa2026_owned", e);
  }
  return {};
}

export function parseLegacyRepeated(): Record<string, number> {
  try {
    const savedRepeated = localStorage.getItem("copa2026_repeated");
    if (savedRepeated) {
      const repeatedArr: string[] = JSON.parse(savedRepeated);
      const counts: Record<string, number> = {};
      repeatedArr.forEach((id) => {
        counts[id] = 2; // Old model assumption
      });
      return counts;
    }
  } catch (e) {
    console.warn("Failed to read copa2026_repeated", e);
  }
  return {};
}

export function saveLocalAlbumState(counts: Record<string, number>) {
  try {
    const data = {
      schemaVersion: 2,
      updatedAt: Date.now(),
      counts
    };
    localStorage.setItem("copa2026_album_v2", JSON.stringify(data));
    
    // Legacy support
    const nextOwned = Object.keys(counts).filter((id) => counts[id] >= 1);
    const nextRepeated = Object.keys(counts).filter((id) => counts[id] >= 2);
    localStorage.setItem("copa2026_owned", JSON.stringify(nextOwned));
    localStorage.setItem("copa2026_repeated", JSON.stringify(nextRepeated));
  } catch (e) {
    console.error("Failed to save local snapshot", e);
  }
}
