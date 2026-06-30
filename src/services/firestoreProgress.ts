import { db } from "../firebase";
import { collection, doc, writeBatch, serverTimestamp, getDocs, setDoc } from "firebase/firestore";
import { normalizeStickerId, normalizeOwnedCount } from "./stickerValidation";

export async function fetchFirestoreProgress(uid: string): Promise<Record<string, number>> {
  if (!uid) return {};
  const counts: Record<string, number> = {};
  
  try {
    const snap = await getDocs(collection(db, "users", uid, "stickers"));
    snap.forEach((docSnap) => {
      const data = docSnap.data();
      if (data.stickerId) {
        counts[data.stickerId] = normalizeOwnedCount(data.ownedCount || 0);
      }
    });
  } catch (error) {
    console.error("Error fetching firestore progress", error);
  }
  return counts;
}

// Ensure the user starts empty if they are new and ignore local data
export async function createEmptyAlbumIfNew(uid: string) {
  if (!uid) return;
  const userRef = doc(db, "users", uid);
  await setDoc(userRef, { onboardingCompleted: true, migrated: true }, { merge: true });
}
