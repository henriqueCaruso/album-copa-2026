export function exportBackup(data: any, filename: string = "album-backup.json") {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function generateBackupObject(
  uid: string,
  firestore: Record<string, number>,
  localV2: Record<string, number>
) {
  const stickers: Record<string, { ownedCount: number; source: string; updatedAt: string }> = {};

  Object.entries(firestore).forEach(([id, count]) => {
    stickers[id] = {
      ownedCount: count,
      source: "firestore",
      updatedAt: new Date().toISOString()
    };
  });

  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    user: {
      uidMasked: uid.substring(0, 4) + "***" + uid.substring(uid.length - 4),
    },
    sources: {
      firestore,
      localStorage: localV2
    },
    stickers,
    pageScans: [],
    metadata: {
      totalOwned: Object.keys(firestore).filter(k => firestore[k] >= 1).length,
      totalUnique: Object.keys(firestore).filter(k => firestore[k] >= 1).length,
      totalRepeated: Object.keys(firestore).filter(k => firestore[k] >= 2).length,
      totalExtraCopies: Object.values(firestore).reduce((acc, c) => acc + Math.max(0, c - 1), 0)
    }
  };
}
