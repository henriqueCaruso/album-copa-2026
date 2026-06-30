import { totalAlbumStickers, stickersMap } from "../data";

export function normalizeStickerId(id: string): string | null {
  if (!id) return null;
  const normalized = id.trim().toUpperCase().replace(/[-\s]+/g, "_");
  
  if (stickersMap[normalized]) {
    return normalized;
  }

  // try to handle cases like BRA_01 -> BRA_1
  const parts = normalized.split("_");
  if (parts.length === 2) {
    const prefix = parts[0];
    const num = parseInt(parts[1], 10);
    if (!isNaN(num)) {
      const alternativeId = `${prefix}_${num}`;
      if (stickersMap[alternativeId]) {
        return alternativeId;
      }
    }
  }

  return null;
}

export function normalizeOwnedCount(count: any): number {
  if (typeof count !== "number") {
    const parsed = parseInt(String(count), 10);
    if (isNaN(parsed)) return 0;
    count = parsed;
  }
  
  if (!isFinite(count) || count < 0) return 0;
  
  // Defensive ceiling to prevent abuse
  if (count > 999) return 999;

  return Math.floor(count);
}
