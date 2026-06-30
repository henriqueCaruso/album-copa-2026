import React, { useState, useEffect, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Camera, Share2, Users, Copy, LogOut, LogIn,
  CheckCircle, Plus, Minus, Sparkles, TrendingUp, HelpCircle,
  Search, Filter, ChevronRight, Check, AlertCircle, Upload, X, Settings
} from "lucide-react";
import {
  db, auth, googleProvider, signInWithPopup, signOut,
  handleFirestoreError, OperationType
} from "./firebase";
import { onAuthStateChanged, User } from "firebase/auth";
import {
  doc, getDoc, setDoc, onSnapshot, collection, writeBatch, serverTimestamp, runTransaction, Timestamp
} from "firebase/firestore";
import {
  countries, pagesMap, stickersMap, totalAlbumStickers, TOTAL_STICKERS, missingFromPhotos, albumSections
} from "./data";
import { UserProfile, UserAlbum, TradeShare, ActivityLog } from "./types";
import { CountryFlag } from "./components/CountryFlag";
import { RecoveryModal } from "./components/RecoveryModal";
import {
  LocalAlbumSnapshot, readLocalAlbumSnapshot, saveLocalAlbumSnapshot,
  hasMeaningfulLocalProgress, getOwnedUniqueCount, getRepeatedUniqueCount,
  getExtraCopiesCount, getTotalPhysicalCopies, getProgressPercent
} from "./utils/albumUtils";

type AuthStatus = "loading" | "guest" | "authenticated" | "error";

type ScanStatus = "available" | "uploading" | "processing" | "reviewing" | "saving" | "completed" | "failed";

interface ReviewSticker {
  id: string;
  number: number;
  label: string;
  type: "detected" | "uncertain" | "missing" | "owned";
  reason?: string;
  confirmed: boolean;
}

export default function App() {
  // Auth States
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [authStatus, setAuthStatus] = useState<AuthStatus>("loading");
  const [showMigrationPrompt, setShowMigrationPrompt] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [localSnapshot, setLocalSnapshot] = useState<LocalAlbumSnapshot | null>(null);

  // Active Navigation Tab
  const [activeTab, setActiveTab] = useState<"album" | "ia" | "stats" | "social">("album");

  // Central Database Progress State
  const [stickerCounts, setStickerCounts] = useState<Record<string, number>>({});
  const [completedPages, setCompletedPages] = useState<string[]>([]);
  const [loadingAlbum, setLoadingAlbum] = useState(false);
  const [savingStickerIds, setSavingStickerIds] = useState<Set<string>>(new Set());

  // Derived arrays for backward compatibility and quick checking
  const ownedStickers = useMemo(() => Object.keys(stickerCounts).filter(id => stickerCounts[id] >= 1), [stickerCounts]);
  const repeatedStickers = useMemo(() => Object.keys(stickerCounts).filter(id => stickerCounts[id] >= 2), [stickerCounts]);

  // Filters and UI controls
  const [searchQuery, setSearchQuery] = useState("");
  const [viewFilter, setViewFilter] = useState<"all" | "missing" | "owned" | "repeated">("all");
  const [activeGroupFilter, setActiveGroupFilter] = useState<string>("all");
  const [showIndex, setShowIndex] = useState(false);
  useEffect(() => {
    if (typeof window !== "undefined") {
      setShowIndex(window.innerWidth >= 768);
    }
  }, []);
  const [highlightedCountry, setHighlightedCountry] = useState<string | null>(null);

  // Share system states
  const [myShareId, setMyShareId] = useState<string | null>(null);
  const [generatingShare, setGeneratingShare] = useState(false);
  const [friendShareId, setFriendShareId] = useState("");
  
  // Friend swap matchup states
  const [viewingFriend, setViewingFriend] = useState(false);
  const [friendProfile, setFriendProfile] = useState<UserProfile | null>(null);
  const [friendAlbum, setFriendAlbum] = useState<UserAlbum | null>(null);
  const [loadingFriend, setLoadingFriend] = useState(false);

  // IA Vision states
  const [selectedPageId, setSelectedPageId] = useState("BRA-PAGE-01");
  const [scanStatus, setScanStatus] = useState<ScanStatus>("available");
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [scanErrorMsg, setScanErrorMsg] = useState<string | null>(null);
  
  // Scanned / Review list
  const [reviewStickers, setReviewStickers] = useState<ReviewSticker[]>([]);
  const [scanWarnings, setScanWarnings] = useState<string[]>([]);

  // Toast state
  const [toast, setToast] = useState<{ message: string; type: "success" | "warn" | "error" | "info" } | null>(null);
  
  // Settings/Recovery Modal
  const [showRecoveryModal, setShowRecoveryModal] = useState(false);

  const showToast = (message: string, type: "success" | "warn" | "error" | "info" = "success") => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(null);
    }, 4000);
  };

  // Get all album pages in order
  const allPagesList = useMemo(() => {
    return countries.flatMap((c) => c.pages);
  }, []);

  // Sync auth state and load real-time listeners
  useEffect(() => {
    let unsubStickers: () => void = () => {};
    let unsubPageScans: () => void = () => {};

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      
      // Cleanup previous listeners if they exist
      unsubStickers();
      unsubPageScans();

      if (currentUser) {
        setAuthStatus("authenticated");
        
        // Temporarily show profile with provider data while fetching full profile
        setProfile({
          uid: currentUser.uid,
          name: currentUser.displayName || "Colecionador",
          email: currentUser.email || "",
          photoURL: currentUser.photoURL || "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&q=80",
          createdAt: new Date().toISOString()
        });

        // 1. Capture local state safely BEFORE doing anything with Firestore
        const currentLocalSnapshot = readLocalAlbumSnapshot();
        
        try {
          // Sync user profile
          const userDocRef = doc(db, "users", currentUser.uid);
          const userSnap = await getDoc(userDocRef);
          
          let userProfile: any;
          if (!userSnap.exists()) {
            userProfile = {
              uid: currentUser.uid,
              displayName: currentUser.displayName || "Colecionador",
              email: currentUser.email || "",
              photoURL: currentUser.photoURL || "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&q=80",
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
              onboardingCompleted: false,
              onboardingVersion: 2
            };
            await setDoc(userDocRef, userProfile);
          } else {
            userProfile = userSnap.data();
          }
          
          // Map to typed profile
          setProfile({
            uid: userProfile.uid,
            name: userProfile.displayName || userProfile.name || "Colecionador",
            email: userProfile.email || "",
            photoURL: userProfile.photoURL || "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&q=80",
            createdAt: userProfile.createdAt
          });

          // 2. Decide if we need to show Onboarding
          // We support legacy 'migrated' field and new 'onboardingCompleted'
          const hasCompletedOnboarding = userProfile.onboardingCompleted || userProfile.migrated;

          if (!hasCompletedOnboarding && hasMeaningfulLocalProgress(currentLocalSnapshot)) {
            setLocalSnapshot(currentLocalSnapshot);
            setShowMigrationPrompt(true);
            setLoadingAlbum(false);
            // DO NOT start listeners yet. Wait for decision.
          } else {
            // Automatically complete onboarding for empty local users or already completed ones
            if (!hasCompletedOnboarding) {
              await setDoc(userDocRef, { onboardingCompleted: true, migrated: true }, { merge: true });
            }
            startRemoteListeners(currentUser.uid);
          }

          // Fetch user share reference
          fetchUserShare(currentUser.uid);

        } catch (error) {
          console.error("Auth sync error:", error);
          setAuthStatus("error");
        }
      } else {
        // Guest User
        setProfile(null);
        setCompletedPages([]);
        setMyShareId(null);
        
        // 1. Read local storage snapshot
        const snapshot = readLocalAlbumSnapshot();
        if (snapshot && Object.keys(snapshot.counts).length > 0) {
          setStickerCounts(snapshot.counts);
        } else {
          // Initialize empty
          setStickerCounts({});
          saveLocalAlbumSnapshot({});
        }
        setAuthStatus("guest");
        setLoadingAlbum(false);
      }
    });

    const startRemoteListeners = (uid: string) => {
      setLoadingAlbum(true);
      unsubStickers = onSnapshot(
        collection(db, "users", uid, "stickers"),
        (querySnap) => {
          const counts: Record<string, number> = {};
          querySnap.forEach((docSnap) => {
            const data = docSnap.data();
            if (data.stickerId) {
              counts[data.stickerId] = data.ownedCount || 0;
            }
          });
          setStickerCounts(counts);
          saveLocalAlbumSnapshot(counts); // Cache locally
          setLoadingAlbum(false);
        },
        (err) => {
          handleFirestoreError(err, OperationType.GET, `users/${uid}/stickers`);
          setLoadingAlbum(false);
        }
      );

      unsubPageScans = onSnapshot(
        collection(db, "users", uid, "pageScans"),
        (querySnap) => {
          const completed: string[] = [];
          querySnap.forEach((docSnap) => {
            const data = docSnap.data();
            if (data.status === "completed") {
              completed.push(docSnap.id);
            }
          });
          setCompletedPages(completed);
        }
      );
    };

    return () => {
      unsubscribe();
      unsubStickers();
      unsubPageScans();
    };
  }, []);

  // Check URL parameters for Shared Code on startup
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const shareId = params.get("share");
    if (shareId) {
      setFriendShareId(shareId);
      loadFriendShare(shareId);
    }
  }, []);

  // Navigation smoothly to Country panel
  const navigateToCountry = (id: string, group: string) => {
    setActiveGroupFilter("all");
    setHighlightedCountry(id);
    setTimeout(() => {
      setHighlightedCountry(null);
    }, 2000);

    setTimeout(() => {
      const element = document.getElementById(`country-${id}`);
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 150);
  };

  const fetchUserShare = async (userId: string) => {
    try {
      const settingsRef = doc(db, "users", userId, "settings", "sharing");
      const settingsSnap = await getDoc(settingsRef);
      if (settingsSnap.exists() && settingsSnap.data().activeShareId) {
        setMyShareId(settingsSnap.data().activeShareId);
      }
    } catch (e) {
      console.warn("Share retrieval skipped:", e);
    }
  };

  // Safe manual adjustments (Counter increase/decrease)
  const setStickerCount = async (stickerId: string, absoluteCount: number) => {
    if (absoluteCount < 0 || isNaN(absoluteCount)) return;

    if (!user) {
      setStickerCounts((prev) => {
        const next = { ...prev, [stickerId]: absoluteCount };
        if (absoluteCount === 0) delete next[stickerId];
        saveLocalAlbumSnapshot(next);
        return next;
      });
      showToast(`Quantidade atualizada para ${absoluteCount} (Salvo localmente).`, "info");
      return;
    }

    setSavingStickerIds(prev => new Set(prev).add(stickerId));
    // Optimistic client-side state update
    setStickerCounts(prev => {
      const nextCounts = { ...prev, [stickerId]: absoluteCount };
      if (absoluteCount === 0) {
        delete nextCounts[stickerId];
      }
      return nextCounts;
    });

    try {
      const stickerRef = doc(db, "users", user.uid, "stickers", stickerId);
      await runTransaction(db, async (transaction) => {
        await transaction.get(stickerRef);
        transaction.set(stickerRef, {
          stickerId,
          ownedCount: absoluteCount,
          isOwned: absoluteCount >= 1,
          isDuplicate: absoluteCount >= 2,
          source: "manual",
          updatedAt: serverTimestamp()
        }, { merge: true });
      });
    } catch (err) {
      console.error("Error saving sticker manual adjustment:", err);
      showToast("Erro ao sincronizar alteração na nuvem.", "error");
      // Rollback
      try {
        const stickerRef = doc(db, "users", user.uid, "stickers", stickerId);
        const snap = await getDoc(stickerRef);
        setStickerCounts(prev => {
          const next = { ...prev };
          if (snap.exists() && snap.data().ownedCount > 0) {
            next[stickerId] = snap.data().ownedCount;
          } else {
            delete next[stickerId];
          }
          return next;
        });
      } catch (e) {}
    } finally {
      setSavingStickerIds(prev => {
        const next = new Set(prev);
        next.delete(stickerId);
        return next;
      });
    }
  };

  const adjustStickerCount = async (stickerId: string, delta: number) => {
    if (!user) {
      setStickerCounts((prev) => {
        const current = prev[stickerId] || 0;
        const nextCount = Math.max(0, current + delta);
        if (nextCount === current) return prev;
        const next = { ...prev, [stickerId]: nextCount };
        if (nextCount === 0) delete next[stickerId];
        saveLocalAlbumSnapshot(next);
        return next;
      });
      return;
    }

    if (savingStickerIds.has(stickerId)) return;
    setSavingStickerIds(prev => new Set(prev).add(stickerId));

    try {
      const stickerRef = doc(db, "users", user.uid, "stickers", stickerId);
      let finalCount = 0;
      await runTransaction(db, async (transaction) => {
        const docSnap = await transaction.get(stickerRef);
        const remoteCount = docSnap.exists() ? (docSnap.data().ownedCount || 0) : 0;
        finalCount = Math.max(0, remoteCount + delta);
        
        transaction.set(stickerRef, {
          stickerId,
          ownedCount: finalCount,
          isOwned: finalCount >= 1,
          isDuplicate: finalCount >= 2,
          source: "manual",
          updatedAt: serverTimestamp()
        }, { merge: true });
      });

      setStickerCounts(prev => {
        const next = { ...prev, [stickerId]: finalCount };
        if (finalCount === 0) delete next[stickerId];
        return next;
      });
    } catch (err) {
      console.error("Error adjusting sticker count:", err);
      showToast("Erro ao sincronizar alteração na nuvem.", "error");
    } finally {
      setSavingStickerIds(prev => {
        const next = new Set(prev);
        next.delete(stickerId);
        return next;
      });
    }
  };

  // Google Provider Login
  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
      showToast("Login realizado com sucesso!", "success");
    } catch (error) {
      showToast("Falha ao autenticar com Google.", "error");
      console.error(error);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setProfile(null);
      setMyShareId(null);
      setViewingFriend(false);
      setFriendAlbum(null);
      setFriendProfile(null);
      setStickerCounts({}); // Clear private state
      setCompletedPages([]);
      // Reload visitor snapshot
      const local = readLocalAlbumSnapshot();
      if (local && local.counts) {
        setStickerCounts(local.counts);
      }
      showToast("Desconectado do Firebase.", "info");
    } catch (error) {
      showToast("Erro ao desconectar.", "error");
    }
  };

  // Perform safe local storage to cloud migration
  const handleMigrate = async () => {
    if (!user || !localSnapshot) return;
    setMigrating(true);
    try {
      const countsToImport = localSnapshot.counts;
      const idsToImport = Object.keys(countsToImport).filter(id => countsToImport[id] > 0);
      
      // We will perform the updates sequentially in small batches due to the read-modify-write need
      for (let i = 0; i < idsToImport.length; i += 200) {
        const chunk = idsToImport.slice(i, i + 200);
        
        await runTransaction(db, async (transaction) => {
          // Read all docs in this chunk
          const docRefs = chunk.map(id => doc(db, "users", user.uid, "stickers", id));
          
          // Execute reads sequentially within the transaction (or get them if possible)
          const reads = await Promise.all(docRefs.map(ref => transaction.get(ref)));
          
          reads.forEach((docSnap, index) => {
            const stickerId = chunk[index];
            const localCount = countsToImport[stickerId];
            
            let finalCount = localCount;
            if (docSnap.exists()) {
              const remoteCount = docSnap.data().ownedCount || 0;
              finalCount = Math.max(localCount, remoteCount);
            }
            
            transaction.set(docRefs[index], {
              stickerId,
              ownedCount: finalCount,
              isOwned: finalCount >= 1,
              isDuplicate: finalCount >= 2,
              source: "migration",
              updatedAt: serverTimestamp()
            }, { merge: true });
          });
        });
      }

      // Update user profile migration status
      const userDocRef = doc(db, "users", user.uid);
      await setDoc(userDocRef, { onboardingCompleted: true, migrated: true }, { merge: true });

      setShowMigrationPrompt(false);
      showToast("Seu progresso local foi mesclado com sucesso para a sua conta!", "success");
      
      // Reload page to start listeners correctly
      window.location.reload();
    } catch (err) {
      console.error("Migration error:", err);
      showToast("Erro ao importar dados locais para a nuvem.", "error");
      setMigrating(false);
    }
  };

  const handleIgnoreMigration = async () => {
    if (!user) return;
    try {
      const userDocRef = doc(db, "users", user.uid);
      await setDoc(userDocRef, { onboardingCompleted: true, migrated: true }, { merge: true });
      setShowMigrationPrompt(false);
      showToast("Você começou com seu álbum em nuvem vazio.", "info");
      
      // Reset local state
      setStickerCounts({});
      saveLocalAlbumSnapshot({});

      // Reload page to start listeners
      window.location.reload();
    } catch (e) {
      console.error(e);
    }
  };

  // AI Scanning Drag & Drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      validateAndLoadImage(file);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      validateAndLoadImage(file);
    }
  };

  const validateAndLoadImage = (file: File) => {
    // 1. Check size (limit to 10MB)
    if (file.size > 10 * 1024 * 1024) {
      showToast("A imagem excede o limite máximo de 10MB.", "error");
      return;
    }
    // 2. Check type
    if (!file.type.startsWith("image/")) {
      showToast("O arquivo enviado não é uma imagem válida.", "error");
      return;
    }

    setUploadedFile(file);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(file));
    setScanStatus("available");
    setScanErrorMsg(null);
    setReviewStickers([]);
  };

  // Triggering the upgraded vision scan page by page
  const triggerVisionScan = async () => {
    if (!user) {
      showToast("Por favor, faça login com Google para usar o Leitor IA.", "warn");
      return;
    }
    if (!uploadedFile) {
      showToast("Selecione ou carregue uma imagem primeiro.", "warn");
      return;
    }

    // Guard: completed check
    if (completedPages.includes(selectedPageId)) {
      showToast("Você já possui uma leitura válida concluída para esta página.", "error");
      return;
    }

    setScanStatus("uploading");
    setScanErrorMsg(null);

    const pageDef = pagesMap[selectedPageId];
    if (!pageDef) {
      setScanStatus("failed");
      setScanErrorMsg("Página de álbum inválida selecionada.");
      return;
    }

    const formData = new FormData();
    formData.append("image", uploadedFile);
    formData.append("pageId", selectedPageId);
    formData.append("stickerIds", pageDef.stickerIds.join(","));

    try {
      setScanStatus("processing");
      const idToken = await user.getIdToken();
      
      const response = await fetch("/api/gemini/analyze", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${idToken}`
        },
        body: formData,
      });

      if (response.status === 401) {
        setScanStatus("failed");
        setScanErrorMsg("Sessão expirada. Por favor, faça login novamente.");
        showToast("Sessão expirada. Autenticação necessária.", "error");
        return;
      }

      if (!response.ok) {
        throw new Error("O servidor retornou um erro ao analisar com Gemini.");
      }

      const result = await response.json();
      
      // Perform strict validation steps
      if (!result || typeof result !== "object") {
        throw new Error("Resposta inválida recebida do motor de IA.");
      }

      const returnedPageId = result.pageId;
      if (returnedPageId !== selectedPageId) {
        throw new Error("A IA analisou a página incorreta ou houve um descompasso.");
      }

      const detections = result.detections || [];
      const uncertainDetections = result.uncertainDetections || [];
      const warnings = result.warnings || [];

      setScanWarnings(warnings);

      // Build Review State list
      const list: ReviewSticker[] = [];
      pageDef.stickerIds.forEach((sid) => {
        const parts = sid.split("_");
        const num = parseInt(parts[1], 10);
        const label = `${countries.find((c) => c.id === pageDef.countryId)?.name || ""} ${num}`;

        const isAlreadyOwned = ownedStickers.includes(sid);

        if (isAlreadyOwned) {
          // Already Owned
          list.push({
            id: sid,
            number: num,
            label,
            type: "owned",
            confirmed: true
          });
        } else {
          // Check if detected
          const det = detections.find((d: any) => d.stickerId === sid);
          const unc = uncertainDetections.find((u: any) => u.stickerId === sid);

          if (det) {
            // High confidence detection
            const conf = Math.max(0, Math.min(1, det.confidence || 0.95));
            list.push({
              id: sid,
              number: num,
              label,
              type: "detected",
              confirmed: conf > 0.85
            });
          } else if (unc) {
            // Uncertain detection
            list.push({
              id: sid,
              number: num,
              label,
              type: "uncertain",
              reason: unc.reason || "Dúvida visual na colagem",
              confirmed: false // User must manually opt-in
            });
          } else {
            // Missing empty space
            list.push({
              id: sid,
              number: num,
              label,
              type: "missing",
              confirmed: false
            });
          }
        }
      });

      setReviewStickers(list);
      setScanStatus("reviewing");
      showToast("Página analisada! Revise as sugestões da IA antes de salvar.", "success");
    } catch (error: any) {
      console.error(error);
      setScanStatus("failed");
      setScanErrorMsg(error?.message || "Ocorreu uma falha ao escaneamento automático da página.");
      showToast("Não foi possível concluir a leitura automática.", "error");
    }
  };

  const handleToggleReviewSticker = (id: string) => {
    setReviewStickers(
      reviewStickers.map((item) => {
        if (item.id === id) {
          return { ...item, confirmed: !item.confirmed };
        }
        return item;
      })
    );
  };

  // Commit verified scan to cloud
  const applyScanResult = async () => {
    if (!user) return;
    setScanStatus("saving");

    try {
      const pageDef = pagesMap[selectedPageId];

      const confirmedIds: string[] = [];
      const rejectedIds: string[] = [];
      const detectedIds: string[] = [];
      const uncertainIds: string[] = [];

      // We process each review item
      for (const item of reviewStickers) {
        if (item.type === "detected") detectedIds.push(item.id);
        if (item.type === "uncertain") uncertainIds.push(item.id);

        if (item.confirmed) {
          confirmedIds.push(item.id);
        } else {
          // If unconfirmed, but was previously owned, we do NOT touch it to avoid breaking pre-existing states
          // unless user wants to explicitly clear it. Let's keep it safe.
          if (item.type !== "owned") {
            rejectedIds.push(item.id);
          }
        }
      }

      await runTransaction(db, async (transaction) => {
        const pageScanRef = doc(db, "users", user.uid, "pageScans", selectedPageId);
        const pageScanSnap = await transaction.get(pageScanRef);

        if (pageScanSnap.exists() && pageScanSnap.data().status === "completed") {
          throw new Error("Página já confirmada anteriormente.");
        }

        // Read all necessary stickers first
        const stickerSnaps = await Promise.all(
          confirmedIds.map(id => transaction.get(doc(db, "users", user.uid, "stickers", id)))
        );

        // Perform all writes
        stickerSnaps.forEach((snap, idx) => {
          const id = confirmedIds[idx];
          const remoteCount = snap.exists() ? (snap.data().ownedCount || 0) : 0;
          const nextCount = Math.max(1, remoteCount);

          transaction.set(snap.ref, {
            stickerId: id,
            ownedCount: nextCount,
            isOwned: true,
            isDuplicate: nextCount >= 2,
            source: "scan",
            updatedAt: serverTimestamp()
          }, { merge: true });
        });

        transaction.set(pageScanRef, {
          pageId: selectedPageId,
          countryId: pageDef.countryId,
          status: "completed",
          detectedStickerIds: detectedIds,
          confirmedStickerIds: confirmedIds,
          rejectedStickerIds: rejectedIds,
          uncertainStickerIds: uncertainIds,
          modelName: "gemini-3.5-flash",
          imageHash: "",
          scannedAt: serverTimestamp(),
          confirmedAt: serverTimestamp(),
          schemaVersion: 1
        });

        const logRef = doc(collection(db, "users", user.uid, "activity"));
        transaction.set(logRef, {
          userId: user.uid,
          type: "stickers_added",
          description: `Concluiu leitura automática da página ${pageDef.title}.`,
          timestamp: serverTimestamp()
        });
      });

      setScanStatus("completed");
      showToast("Página salva e sincronizada na nuvem com sucesso!", "success");
      
      // Cleanup
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setReviewStickers([]);
      setUploadedFile(null);
      setPreviewUrl(null);
      setActiveTab("album");
      
      // Redirect to the country
      const countryObj = countries.find((c) => c.id === pageDef.countryId);
      if (countryObj) {
        navigateToCountry(countryObj.id, countryObj.group);
      }
    } catch (err: any) {
      console.error(err);
      if (err.message === "Página já confirmada anteriormente.") {
        showToast("Erro: Leitura já concluída para esta página.", "error");
        setScanStatus("available");
      } else {
        setScanErrorMsg("Falha ao salvar as figurinhas lidas.");
        setScanStatus("failed");
      }
    }
  };

  const handleDiscardScan = () => {
    setReviewStickers([]);
    setUploadedFile(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setScanStatus("available");
    setScanErrorMsg(null);
    showToast("Leitura descartada. A tentativa não foi consumida.", "info");
  };

  // Social Sharing Link Generator
  const generateMyShareLink = async () => {
    if (!user || !profile) {
      showToast("Faça login com Google para compartilhar online.", "warn");
      return;
    }

    setGeneratingShare(true);
    const newShareId = myShareId || Math.random().toString(36).substring(2, 10).toUpperCase();

    try {
      const missingStickerIds = totalAlbumStickers.filter((id) => (stickerCounts[id] || 0) === 0);
      const repeatedCounts: Record<string, number> = {};
      
      Object.keys(stickerCounts).forEach(id => {
        if (stickerCounts[id] > 1) {
          repeatedCounts[id] = stickerCounts[id] - 1; // Number of *extra* copies
        }
      });

      const shareDoc: TradeShare = {
        shareId: newShareId,
        ownerUid: user.uid,
        displayName: profile.name,
        photoURL: profile.photoURL,
        missingStickerIds,
        repeatedCounts,
        updatedAt: serverTimestamp(),
        expiresAt: Timestamp.fromDate(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)),
        isPublic: true
      };

      await setDoc(doc(db, "trade_shares", newShareId), shareDoc);
      const settingsRef = doc(db, "users", user.uid, "settings", "sharing");
      await setDoc(settingsRef, {
        activeShareId: newShareId,
        updatedAt: serverTimestamp()
      }, { merge: true });
      
      setMyShareId(newShareId);
      showToast("Link de trocas atualizado e ativo por 30 dias!", "success");
    } catch (e) {
      console.error(e);
      showToast("Falha ao criar link de compartilhamento.", "error");
    } finally {
      setGeneratingShare(false);
    }
  };

  const disableMyShare = async () => {
    if (!user || !myShareId) return;
    try {
      await setDoc(doc(db, "trade_shares", myShareId), { isPublic: false, updatedAt: serverTimestamp() }, { merge: true });
      await setDoc(doc(db, "users", user.uid, "settings", "sharing"), {
        activeShareId: null,
        updatedAt: serverTimestamp()
      }, { merge: true });
      setMyShareId(null);
      showToast("Compartilhamento desativado com sucesso.", "success");
    } catch (e) {
      console.error(e);
      showToast("Falha ao desativar compartilhamento.", "error");
    }
  };

  const loadFriendShare = async (shareIdToLoad: string) => {
    if (!shareIdToLoad.trim()) return;
    setLoadingFriend(true);
    setViewingFriend(false);

    try {
      const shareSnap = await getDoc(doc(db, "trade_shares", shareIdToLoad.trim().toUpperCase()));
      if (!shareSnap.exists()) {
        showToast("Código de troca expirado ou inexistente.", "error");
        setLoadingFriend(false);
        return;
      }

      const shareData = shareSnap.data() as TradeShare;
      
      setFriendProfile({
        uid: shareData.ownerUid,
        name: shareData.displayName,
        email: "",
        photoURL: shareData.photoURL || "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&q=80",
        createdAt: shareData.updatedAt
      });

      const friendMissing = shareData.missingStickerIds || [];
      const friendOwned = totalAlbumStickers.filter(id => !friendMissing.includes(id));
      const friendRepeated = Object.keys(shareData.repeatedCounts || {});

      setFriendAlbum({
        userId: shareData.ownerUid,
        ownedStickers: friendOwned,
        repeatedStickers: friendRepeated,
        lastUpdated: shareData.updatedAt,
        progressPercent: Math.round((friendOwned.length / TOTAL_STICKERS) * 100)
      });
      setViewingFriend(true);
      setActiveTab("social");
      showToast("Lista do amigo carregada lado a lado!", "success");
    } catch (err) {
      console.error(err);
      showToast("Erro ao carregar lista do amigo.", "error");
    } finally {
      setLoadingFriend(false);
    }
  };

  // Helper counters
  const globalProgressPercent = useMemo(() => {
    return Math.round((ownedStickers.length / TOTAL_STICKERS) * 100);
  }, [ownedStickers]);

  const globalMissingCount = useMemo(() => {
    return Math.max(0, TOTAL_STICKERS - ownedStickers.length);
  }, [ownedStickers]);

  // Social Swapping Cross Match Algorithm
  const matchTrades = useMemo(() => {
    if (!viewingFriend || !friendAlbum) return { canGive: [], canGet: [] };

    const myMissing = totalAlbumStickers.filter((id) => !ownedStickers.includes(id));
    const friendMissing = totalAlbumStickers.filter((id) => !friendAlbum.ownedStickers.includes(id));

    const canGive = repeatedStickers.filter((id) => friendMissing.includes(id));
    const canGet = friendAlbum.repeatedStickers.filter((id) => myMissing.includes(id));

    return { canGive, canGet };
  }, [viewingFriend, friendAlbum, ownedStickers, repeatedStickers]);

  // Insights
  const statsInsights = useMemo(() => {
    let bestTeam = "Nenhum";
    let maxPct = -1;
    let bestGroup = "Nenhum";
    let maxGroupPct = -1;

    const groupStats: Record<string, { total: number; owned: number }> = {};

    countries.forEach((country) => {
      let ownedCount = 0;
      country.pages.forEach((page) => {
        page.stickerIds.forEach((sid) => {
          if (stickerCounts[sid] >= 1) ownedCount++;
        });
      });

      const totalCount = country.pages.reduce((sum, p) => sum + p.stickerIds.length, 0);
      const pct = Math.round((ownedCount / totalCount) * 100);

      if (pct > maxPct) {
        maxPct = pct;
        bestTeam = `${country.name} (${pct}%)`;
      }

      if (!groupStats[country.group]) {
        groupStats[country.group] = { total: 0, owned: 0 };
      }
      groupStats[country.group].total += totalCount;
      groupStats[country.group].owned += ownedCount;
    });

    Object.keys(groupStats).forEach((grp) => {
      const grpPct = Math.round((groupStats[grp].owned / groupStats[grp].total) * 100);
      if (grpPct > maxGroupPct) {
        maxGroupPct = grpPct;
        bestGroup = `Grupo ${grp.toUpperCase()} (${grpPct}%)`;
      }
    });

    let rank = "Iniciante ⭐️";
    if (globalProgressPercent >= 25) rank = "Bronze 🥉";
    if (globalProgressPercent >= 50) rank = "Prata 🥈";
    if (globalProgressPercent >= 75) rank = "Ouro 🥇";
    if (globalProgressPercent >= 95) rank = "Mestre das Trocas 💎";
    if (globalProgressPercent === 100) rank = "CAMPEÃO DO ÁLBUM 🏆";

    return { bestTeam, bestGroup, rank };
  }, [stickerCounts, globalProgressPercent]);

  // Export / Backup State (Client Side)
  const exportStateCode = () => {
    const backupObj = { counts: stickerCounts };
    const token = btoa(unescape(encodeURIComponent(JSON.stringify(backupObj))));
    navigator.clipboard.writeText(token);
    showToast("Código de backup copiado!", "success");
  };

  const importStateCode = () => {
    const token = prompt("Insira o seu Código de Backup:");
    if (!token) return;
    try {
      const parsed = JSON.parse(decodeURIComponent(escape(atob(token))));
      if (parsed && parsed.counts) {
        setStickerCounts(parsed.counts);
        
        const nextOwned = Object.keys(parsed.counts).filter((id) => parsed.counts[id] >= 1);
        const nextRepeated = Object.keys(parsed.counts).filter((id) => parsed.counts[id] >= 2);
        localStorage.setItem("copa2026_owned", JSON.stringify(nextOwned));
        localStorage.setItem("copa2026_repeated", JSON.stringify(nextRepeated));

        if (user) {
          const batch = writeBatch(db);
          Object.keys(parsed.counts).forEach((sid) => {
            const count = parsed.counts[sid];
            const ref = doc(db, "users", user.uid, "stickers", sid);
            batch.set(ref, {
              stickerId: sid,
              ownedCount: count,
              isOwned: count >= 1,
              isDuplicate: count >= 2,
              source: "manual",
              updatedAt: serverTimestamp()
            });
          });
          batch.commit();
        }
        showToast("Backup importado e sincronizado com sucesso!", "success");
      } else {
        showToast("Backup inválido ou corrompido.", "error");
      }
    } catch (e) {
      showToast("Formato de código inválido.", "error");
    }
  };

  const resetToPhotos = () => {
    if (confirm("Deseja redefinir o álbum para as figurinhas detectadas inicialmente nas fotos?")) {
      const counts: Record<string, number> = {};
      totalAlbumStickers.forEach((id) => {
        const [prefix, numStr] = id.split("_");
        const num = parseInt(numStr, 10);
        const missingList = missingFromPhotos[prefix];
        if (!missingList || !missingList.includes(num)) {
          counts[id] = 1;
        }
      });

      setStickerCounts(counts);
      saveLocalAlbumSnapshot(counts);

      if (user) {
        const updateChunks = async () => {
          const ids = Object.keys(counts);
          for (let i = 0; i < ids.length; i += 450) {
            const chunk = ids.slice(i, i + 450);
            const batch = writeBatch(db);
            chunk.forEach((id) => {
              const ref = doc(db, "users", user.uid, "stickers", id);
              batch.set(ref, {
                stickerId: id,
                ownedCount: counts[id],
                isOwned: true,
                isDuplicate: false,
                source: "reset",
                updatedAt: serverTimestamp()
              });
            });
            await batch.commit();
          }
        };
        updateChunks().catch(console.error);
      }
      showToast("Álbum restaurado para as fotos originais!", "info");
    }
  };

  const clearProgressTotal = () => {
    if (confirm("🚨 ATENÇÃO: Deseja zerar totalmente seu álbum? Todas as figurinhas constarão como faltantes.")) {
      setStickerCounts({});
      saveLocalAlbumSnapshot({});

      if (user) {
        const updateChunks = async () => {
          // Firebase batch limit is 500, we delete in chunks.
          const owned = Object.keys(stickerCounts);
          for (let i = 0; i < owned.length; i += 450) {
            const chunk = owned.slice(i, i + 450);
            const batch = writeBatch(db);
            chunk.forEach(id => {
              const ref = doc(db, "users", user.uid, "stickers", id);
              batch.delete(ref);
            });
            await batch.commit();
          }
        };
        updateChunks().catch(console.error);
      }
      showToast("Seu álbum foi totalmente zerado.", "warn");
    }
  };

  const copyWhatsAppList = () => {
    let textOutput = "📋 MINHAS FIGURINHAS FALTANTES (COPA 2026):\n\n";
    let totalMissing = 0;

    countries.forEach((country) => {
      const sectionMissing: string[] = [];
      country.pages.forEach((page) => {
        page.stickerIds.forEach((sid) => {
          if ((stickerCounts[sid] || 0) === 0) {
            const parts = sid.split("_");
            sectionMissing.push(`${country.fifaCode} ${parts[1]}`);
            totalMissing++;
          }
        });
      });

      if (sectionMissing.length > 0) {
        textOutput += `👉 ${country.name}: ${sectionMissing.join(", ")}\n\n`;
      }
    });

    textOutput += `📊 Total restante: ${totalMissing} de ${TOTAL_STICKERS}`;
    navigator.clipboard.writeText(textOutput);
    showToast("Lista de faltas copiada para WhatsApp!", "success");
  };

  return (
    <div className="bg-[#0f0303] text-stone-200 min-h-screen flex flex-col font-sans selection:bg-[#6b0b0b] selection:text-white pb-20 md:pb-12">
      
      {/* Toast Notifications */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.9 }}
            className={`fixed bottom-5 right-5 z-50 flex items-center gap-3 px-5 py-3 rounded-xl shadow-2xl border ${
              toast.type === "success" ? "bg-stone-900 text-emerald-400 border-emerald-500/30" :
              toast.type === "warn" ? "bg-stone-900 text-amber-400 border-amber-500/30" :
              toast.type === "error" ? "bg-stone-900 text-rose-400 border-rose-500/30" :
              "bg-stone-900 text-stone-200 border-stone-800"
            }`}
          >
            <span className="text-lg">
              {toast.type === "success" ? "✅" : toast.type === "warn" ? "⚠️" : toast.type === "error" ? "🚨" : "✨"}
            </span>
            <span className="text-sm font-semibold">{toast.message}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* High-Fidelity Onboarding Modal */}
      <AnimatePresence>
        {showMigrationPrompt && user && localSnapshot && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md"
          >
            <motion.div
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              className="bg-[#1a0505] border border-stone-800 rounded-2xl p-6 md:p-8 max-w-md w-full shadow-2xl space-y-6 relative overflow-hidden"
            >
              <div className="absolute inset-0 bg-opacity-5 bg-[radial-gradient(#ffffff_1px,transparent_1px)] [background-size:16px_16px] pointer-events-none" />
              
              <div className="relative z-10 space-y-2 text-center">
                <div className="w-12 h-12 bg-[#6b0b0b] rounded-full flex items-center justify-center border border-[#d4af37]/30 shadow-md mx-auto mb-4">
                  <Sparkles className="w-6 h-6 text-[#d4af37]" />
                </div>
                <h2 className="text-xl md:text-2xl font-black text-stone-100 uppercase tracking-tight">Como deseja iniciar seu álbum?</h2>
                <p className="text-sm text-stone-400">Encontramos figurinhas salvas neste navegador. Escolha o que fazer com elas.</p>
              </div>

              <div className="space-y-4 relative z-10">
                <button
                  onClick={handleMigrate}
                  disabled={migrating}
                  className="w-full bg-stone-900 border border-emerald-500/30 hover:border-emerald-500/60 p-4 rounded-xl text-left transition disabled:opacity-50 group"
                >
                  <h3 className="text-emerald-400 font-bold uppercase tracking-wider text-sm flex items-center justify-between">
                    Usar meu progresso atual
                    <ChevronRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </h3>
                  <p className="text-xs text-stone-400 mt-1 mb-3">Importar as figurinhas que já estão marcadas neste navegador para a sua conta.</p>
                  
                  <div className="grid grid-cols-4 gap-2 text-center bg-stone-950 p-2 rounded-lg border border-stone-800">
                    <div>
                      <span className="block text-emerald-400 font-bold">{getOwnedUniqueCount(localSnapshot.counts)}</span>
                      <span className="block text-[9px] uppercase text-stone-500">Únicas</span>
                    </div>
                    <div>
                      <span className="block text-amber-400 font-bold">{getExtraCopiesCount(localSnapshot.counts)}</span>
                      <span className="block text-[9px] uppercase text-stone-500">Extras</span>
                    </div>
                    <div>
                      <span className="block text-rose-400 font-bold">{TOTAL_STICKERS - getOwnedUniqueCount(localSnapshot.counts)}</span>
                      <span className="block text-[9px] uppercase text-stone-500">Faltam</span>
                    </div>
                    <div>
                      <span className="block text-[#d4af37] font-bold">{getProgressPercent(localSnapshot.counts)}%</span>
                      <span className="block text-[9px] uppercase text-stone-500">Total</span>
                    </div>
                  </div>
                </button>

                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-stone-800"></div>
                  </div>
                  <div className="relative flex justify-center text-[10px] uppercase font-bold text-stone-600 tracking-widest">
                    <span className="bg-[#1a0505] px-2">ou</span>
                  </div>
                </div>

                <button
                  onClick={() => {
                    if (window.confirm("O progresso atual continuará salvo neste navegador para usuários offline, mas não será importado para esta conta. Tem certeza que deseja iniciar um álbum vazio na nuvem?")) {
                      handleIgnoreMigration();
                    }
                  }}
                  disabled={migrating}
                  className="w-full bg-stone-900 border border-stone-800 hover:border-stone-600 p-4 rounded-xl text-left transition disabled:opacity-50 group"
                >
                  <h3 className="text-stone-300 font-bold uppercase tracking-wider text-sm flex items-center justify-between">
                    Começar do Zero
                    <ChevronRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </h3>
                  <p className="text-xs text-stone-500 mt-1">Criar um álbum vazio nesta conta. O progresso local continuará salvo offline.</p>
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Settings / Recovery Modal */}
      {showRecoveryModal && user && (
        <RecoveryModal onClose={() => setShowRecoveryModal(false)} uid={user.uid} />
      )}

      {/* Header Panel */}
      <header className="bg-[#1a0505] text-stone-200 mt-3 mx-2.5 md:mt-6 md:mx-8 p-3 md:p-6 border border-stone-800 rounded-xl md:rounded-2xl shadow-xl relative overflow-hidden">
        <div className="absolute inset-0 bg-opacity-5 bg-[radial-gradient(#ffffff_1px,transparent_1px)] [background-size:16px_16px] pointer-events-none" />
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4 relative z-10">
          
          <div className="flex items-center gap-2 md:gap-4 justify-start">
            <div className="w-9 h-9 md:w-12 md:h-12 bg-[#6b0b0b] rounded-lg md:rounded-xl flex items-center justify-center border border-[#d4af37]/30 shadow-md shrink-0">
              <span className="text-[#d4af37] font-extrabold text-lg md:text-2xl font-display">26</span>
            </div>
            <div className="text-left">
              <h1 className="text-base md:text-2xl font-black tracking-tight text-stone-100 uppercase font-display flex items-center gap-1 md:gap-2 leading-tight">
                🏆 <span className="hidden sm:inline">Álbum Copa 2026</span><span className="sm:hidden">Álbum 2026</span>
              </h1>
              <p className="hidden md:block text-xs text-stone-500 font-medium uppercase tracking-widest mt-0.5">
                SaaS Multi-usuário com Gemini Vision
              </p>
            </div>
          </div>

          {/* Nav & Social Auth Buttons */}
          <div className="flex items-center gap-2 md:gap-4 shrink-0">
            {/* Desktop Navigation Tab selector */}
            <div className="hidden md:flex bg-stone-900/80 p-1 rounded-xl border border-stone-800">
              <button
                onClick={() => { setActiveTab("album"); setViewingFriend(false); }}
                className={`px-4 py-2 rounded-lg text-xs md:text-sm font-bold uppercase tracking-wider smooth-transition ${
                  activeTab === "album" && !viewingFriend ? "bg-[#6b0b0b] text-white border border-[#d4af37]/20 shadow" : "text-stone-400 hover:text-stone-100 hover:bg-white/5"
                }`}
              >
                📖 Álbum
              </button>
              <button
                onClick={() => { setActiveTab("ia"); setViewingFriend(false); }}
                className={`px-4 py-2 rounded-lg text-xs md:text-sm font-bold uppercase tracking-wider smooth-transition flex items-center gap-1 ${
                  activeTab === "ia" && !viewingFriend ? "bg-[#6b0b0b] text-white border border-[#d4af37]/20 shadow" : "text-stone-400 hover:text-stone-100 hover:bg-white/5"
                }`}
              >
                <Camera className="w-3.5 h-3.5 text-[#d4af37]" />
                <span>Escanear IA</span>
              </button>
              <button
                onClick={() => { setActiveTab("stats"); setViewingFriend(false); }}
                className={`px-4 py-2 rounded-lg text-xs md:text-sm font-bold uppercase tracking-wider smooth-transition ${
                  activeTab === "stats" && !viewingFriend ? "bg-[#6b0b0b] text-white border border-[#d4af37]/20 shadow" : "text-stone-400 hover:text-stone-100 hover:bg-white/5"
                }`}
              >
                📊 Estatísticas
              </button>
              <button
                onClick={() => { setActiveTab("social"); }}
                className={`px-4 py-2 rounded-lg text-xs md:text-sm font-bold uppercase tracking-wider smooth-transition flex items-center gap-1 ${
                  activeTab === "social" || viewingFriend ? "bg-[#6b0b0b] text-white border border-[#d4af37]/20 shadow" : "text-stone-400 hover:text-stone-100 hover:bg-white/5"
                }`}
              >
                <Users className="w-3.5 h-3.5 text-[#d4af37]" />
                <span>Trocas {viewingFriend && "💡"}</span>
              </button>
            </div>

            {/* Auth Block */}
            {profile ? (
              <div className="flex items-center gap-1.5 md:gap-3 bg-stone-900 border border-stone-800 p-1 md:p-1.5 md:pr-3 rounded-full">
                <img
                  src={profile.photoURL}
                  alt={profile.name}
                  className="w-7 h-7 md:w-8 md:h-8 rounded-full object-cover border border-[#d4af37]"
                />
                <div className="hidden md:block text-left">
                  <p className="text-xs font-bold leading-none text-stone-200">{profile.name}</p>
                  <p className="text-[10px] text-stone-500 uppercase font-bold tracking-tighter mt-0.5">Colecionador</p>
                </div>
                <button
                  onClick={() => setShowRecoveryModal(true)}
                  className="p-1.5 hover:bg-white/10 rounded-full text-stone-400 hover:text-stone-200 smooth-transition min-h-[36px] min-w-[36px] flex items-center justify-center"
                  title="Configurações e Recuperação"
                >
                  <Settings className="w-4 h-4" />
                </button>
                <button
                  onClick={handleLogout}
                  className="p-1.5 hover:bg-white/10 rounded-full text-stone-400 hover:text-rose-400 smooth-transition min-h-[36px] min-w-[36px] flex items-center justify-center"
                  title="Desconectar"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button
                onClick={handleLogin}
                className="bg-[#6b0b0b]/90 hover:bg-[#6b0b0b] text-stone-100 border border-stone-800 hover:border-[#d4af37]/30 px-3 py-1.5 md:px-4 md:py-2.5 rounded-xl text-[10px] md:text-xs font-bold uppercase flex items-center gap-1.5 smooth-transition shadow-lg min-h-[38px]"
              >
                <LogIn className="w-3.5 h-3.5 text-[#d4af37]" />
                <span className="hidden sm:inline">Entrar com Google</span>
                <span className="sm:hidden">Entrar</span>
              </button>
            )}
          </div>

        </div>
      </header>

      {/* Real-time Sticky Counter Dashboard */}
      <div className="bg-[#1a0505]/95 border-b border-stone-800/80 shadow-2xl py-3 px-3 md:py-4 md:px-8 sticky top-0 z-30 transition-all backdrop-blur-md">
        <div className="max-w-7xl mx-auto">
          {/* Mobile Dashboard */}
          <div className="flex flex-col gap-2.5 md:hidden">
            {/* Row 1: circular progress + stats cards */}
            <div className="flex items-center justify-between gap-3 w-full">
              <div className="flex items-center gap-2">
                <div className="relative flex items-center justify-center shrink-0">
                  <svg className="w-10 h-10 transform -rotate-90">
                    <circle cx="20" cy="20" r="17" stroke="#292524" strokeWidth="3" fill="transparent" />
                    <circle
                      cx="20"
                      cy="20"
                      r="17"
                      stroke="#16a34a"
                      strokeWidth="3"
                      fill="transparent"
                      strokeDasharray="106.8"
                      strokeDashoffset={106.8 - (globalProgressPercent / 100) * 106.8}
                      className="transition-all duration-700 ease-out"
                    />
                  </svg>
                  <span className="absolute text-[9px] font-black text-stone-200">{globalProgressPercent}%</span>
                </div>
                <div className="text-left">
                  <span className="text-[8px] text-stone-500 font-bold uppercase tracking-widest block">Álbum</span>
                  <p className="text-xs font-semibold text-stone-300">
                    <strong className="text-[#16a34a] text-sm font-black">{ownedStickers.length}</strong> / <strong className="font-bold text-stone-400">{TOTAL_STICKERS}</strong>
                  </p>
                </div>
              </div>

              <div className="flex gap-1.5 shrink-0">
                <div className="bg-stone-900 border border-stone-800/80 rounded-lg px-2 py-0.5 text-center min-w-[64px]">
                  <span className="text-[7px] text-stone-500 font-bold uppercase block">Faltantes</span>
                  <span className="text-xs font-black text-[#f87171]">{globalMissingCount}</span>
                </div>
                <div className="bg-stone-900 border border-stone-800/80 rounded-lg px-2 py-0.5 text-center min-w-[64px]">
                  <span className="text-[7px] text-stone-500 font-bold uppercase block">Repetidas</span>
                  <span className="text-xs font-black text-[#fbbf24]">{repeatedStickers.length}</span>
                </div>
              </div>
            </div>

            {/* Friend info if viewing friend */}
            {viewingFriend && friendProfile && (
              <div className="bg-[#d4af37]/5 border border-[#d4af37]/30 rounded-lg px-3 py-1 flex items-center justify-between text-left">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-[#d4af37]" />
                  <p className="text-[10px] text-stone-300 leading-tight">
                    Trocas com: <strong>{friendProfile.name}</strong> ({friendAlbum?.progressPercent || 0}%)
                  </p>
                </div>
                <button
                  onClick={() => {
                    setViewingFriend(false);
                    setFriendAlbum(null);
                    setFriendProfile(null);
                    showToast("Fechou painel de comparação social.", "info");
                  }}
                  className="text-[#d4af37] hover:text-white font-bold text-[10px] underline"
                >
                  Sair
                </button>
              </div>
            )}

            {/* Row 2: Search in full width */}
            <div className="w-full relative">
              <Search className="w-3.5 h-3.5 text-stone-500 absolute left-2.5 top-2.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar país, número ou sigla..."
                className="w-full pl-8 pr-3 py-2 bg-stone-900 border border-stone-800 rounded-xl focus:border-[#d4af37] outline-none text-xs text-stone-100 placeholder-stone-600"
              />
            </div>

            {/* Row 3: Select and share */}
            <div className="flex gap-2 w-full">
              <select
                value={viewFilter}
                onChange={(e) => setViewFilter(e.target.value as any)}
                className="flex-1 px-2 py-2 bg-stone-900 border border-stone-800 rounded-xl text-xs font-bold text-stone-400 outline-none cursor-pointer focus:border-[#d4af37]"
              >
                <option value="all">Todas as Figurinhas</option>
                <option value="missing">Mostrar Faltantes</option>
                <option value="owned">Mostrar Coladas</option>
                <option value="repeated">Mostrar Repetidas</option>
              </select>

              <button
                onClick={copyWhatsAppList}
                className="bg-[#6b0b0b]/80 hover:bg-[#6b0b0b] text-[#d4af37] border border-[#d4af37]/30 font-bold px-3 py-2 rounded-xl text-xs uppercase tracking-wide transition active:scale-95 shadow flex items-center gap-1 shrink-0 justify-center min-h-[40px]"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>Compartilhar</span>
              </button>
            </div>
          </div>

          {/* Desktop Dashboard */}
          <div className="hidden md:flex flex-col lg:flex-row gap-6 items-center justify-between">
            <div className="flex items-center gap-4 justify-between lg:justify-start">
              <div className="flex items-center gap-3">
                <div className="relative flex items-center justify-center">
                  <svg className="w-14 h-14 transform -rotate-90">
                    <circle cx="28" cy="28" r="24" stroke="#292524" strokeWidth="5" fill="transparent" />
                    <circle
                      cx="28"
                      cy="28"
                      r="24"
                      stroke="#16a34a"
                      strokeWidth="5"
                      fill="transparent"
                      strokeDasharray="150.8"
                      strokeDashoffset={150.8 - (globalProgressPercent / 100) * 150.8}
                      className="transition-all duration-700 ease-out"
                    />
                  </svg>
                  <span className="absolute text-xs font-black text-stone-200">{globalProgressPercent}%</span>
                </div>
                <div className="text-left">
                  <span className="text-[10px] text-stone-500 font-extrabold uppercase tracking-widest block">Álbum Completado</span>
                  <p className="text-sm font-medium text-stone-300">
                    <strong className="text-[#16a34a] text-lg font-black">{ownedStickers.length}</strong> de <strong className="font-bold text-stone-400">{TOTAL_STICKERS}</strong> coladas
                  </p>
                </div>
              </div>

              <div className="h-8 w-px bg-stone-800 hidden sm:block" />

              <div className="text-right sm:text-left">
                <span className="text-[10px] text-stone-500 font-extrabold uppercase tracking-widest block">Faltantes</span>
                <span className="text-xl font-black text-[#6b0b0b]">{globalMissingCount}</span>
              </div>

              <div className="h-8 w-px bg-stone-800 hidden sm:block" />

              <div className="text-right sm:text-left">
                <span className="text-[10px] text-stone-500 font-extrabold uppercase tracking-widest block">Repetidas</span>
                <span className="text-xl font-black text-[#d4af37]">{repeatedStickers.length}</span>
              </div>
            </div>

            {viewingFriend && friendProfile && (
              <div className="bg-[#d4af37]/5 border border-[#d4af37]/30 rounded-xl px-4 py-2 flex items-center gap-3 animate-pulse">
                <Users className="w-5 h-5 text-[#d4af37]" />
                <div className="text-left">
                  <p className="text-xs font-black text-[#d4af37] uppercase">Visualizando Trocas Cruzadas</p>
                  <p className="text-[11px] text-stone-400">Com: <strong>{friendProfile.name}</strong> ({friendAlbum?.progressPercent || 0}% completo)</p>
                </div>
                <button
                  onClick={() => {
                    setViewingFriend(false);
                    setFriendAlbum(null);
                    setFriendProfile(null);
                    showToast("Fechou painel de comparação social.", "info");
                  }}
                  className="text-[#d4af37] hover:text-white font-bold text-xs underline ml-2"
                >
                  Sair
                </button>
              </div>
            )}

            <div className="w-full lg:w-auto flex flex-wrap gap-2 items-center justify-end">
              <div className="relative flex-1 lg:w-64">
                <Search className="w-4 h-4 text-stone-500 absolute left-3 top-3.5" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Buscar país, número ou sigla..."
                  className="w-full pl-9 pr-4 py-2.5 bg-stone-900 border border-stone-800 rounded-xl focus:border-[#d4af37] outline-none text-xs md:text-sm text-stone-100 transition-all placeholder-stone-600"
                />
              </div>

              <select
                value={viewFilter}
                onChange={(e) => setViewFilter(e.target.value as any)}
                className="px-3 py-2.5 bg-stone-900 border border-stone-800 rounded-xl text-xs font-bold text-stone-400 outline-none cursor-pointer focus:border-[#d4af37]"
              >
                <option value="all">Todas as Figurinhas</option>
                <option value="missing">Mostrar Faltantes</option>
                <option value="owned">Mostrar Coladas</option>
                <option value="repeated">Mostrar Repetidas</option>
              </select>

              <button
                onClick={copyWhatsAppList}
                className="bg-[#6b0b0b]/80 hover:bg-[#6b0b0b] text-[#d4af37] border border-[#d4af37]/30 font-bold px-3 py-2.5 rounded-xl text-xs uppercase tracking-wide transition active:scale-95 shadow flex items-center gap-1"
              >
                <Copy className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Compartilhar</span> Faltantes
              </button>
            </div>
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-4 w-full flex-1 mt-6 space-y-6">
        
        {/* VIEW 1: ALBUM TAB */}
        {activeTab === "album" && (
          <div className="space-y-6">
            
            {/* Country Group Selection Filters - Desktop */}
            <div className="hidden md:flex bg-[#1a0505] rounded-2xl border border-stone-800 p-4 shadow-2xl flex-row items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] text-stone-500 font-extrabold uppercase tracking-widest block">Exibição:</span>
                <button
                  onClick={() => setActiveGroupFilter("all")}
                  className={`text-xs font-bold px-3 py-1.5 rounded-lg uppercase transition-all border ${
                    activeGroupFilter === "all" ? "bg-[#6b0b0b] text-white border-[#d4af37]/20 shadow" : "bg-stone-900 text-stone-400 border-stone-800 hover:bg-stone-800 hover:text-stone-100"
                  }`}
                >
                  Todas
                </button>
                <button
                  onClick={() => setActiveGroupFilter("especiais")}
                  className={`text-xs font-bold px-3 py-1.5 rounded-lg uppercase transition-all border ${
                    activeGroupFilter === "especiais" ? "bg-[#6b0b0b] text-white border-[#d4af37]/20 shadow" : "bg-stone-900 text-stone-400 border-stone-800 hover:bg-stone-800 hover:text-stone-100"
                  }`}
                >
                  🌟 Especiais
                </button>
              </div>
              
              <div className="flex flex-wrap items-center gap-1.5 justify-center">
                <span className="text-[10px] text-stone-500 font-extrabold uppercase tracking-widest block mr-1">Grupos:</span>
                {["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"].map((grp) => (
                  <button
                    key={grp}
                    onClick={() => setActiveGroupFilter(grp)}
                    className={`w-8 h-8 rounded-lg font-black text-xs uppercase flex items-center justify-center transition-all border ${
                      activeGroupFilter === grp ? "bg-[#6b0b0b] text-white border-[#d4af37]/20 shadow" : "bg-stone-900 text-stone-400 border-stone-800 hover:bg-stone-800 hover:text-stone-100"
                    }`}
                  >
                    {grp}
                  </button>
                ))}
              </div>
            </div>

            {/* Country Group Selection Filters - Mobile */}
            <div className="md:hidden bg-[#1a0505] rounded-xl border border-stone-800 p-3 shadow-xl space-y-2.5">
              <div className="flex items-center gap-2">
                <span className="text-[9px] text-stone-500 font-extrabold uppercase tracking-widest">Exibição:</span>
                <button
                  type="button"
                  onClick={() => setActiveGroupFilter("all")}
                  className={`text-[10px] font-bold px-3 py-1.5 rounded-lg uppercase border transition ${
                    activeGroupFilter === "all" ? "bg-[#6b0b0b] text-white border-[#d4af37]/20 shadow" : "bg-stone-900 text-stone-400 border-stone-800"
                  }`}
                >
                  Todas
                </button>
                <button
                  type="button"
                  onClick={() => setActiveGroupFilter("especiais")}
                  className={`text-[10px] font-bold px-3 py-1.5 rounded-lg uppercase border transition ${
                    activeGroupFilter === "especiais" ? "bg-[#6b0b0b] text-white border-[#d4af37]/20 shadow" : "bg-stone-900 text-stone-400 border-stone-800"
                  }`}
                >
                  🌟 Especiais
                </button>
              </div>
              
              <div className="flex items-center gap-2 border-t border-stone-800/60 pt-2">
                <span className="text-[9px] text-stone-500 font-extrabold uppercase tracking-widest shrink-0">Grupos:</span>
                <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none scroll-smooth w-full px-1" style={{ WebkitOverflowScrolling: "touch" }}>
                  {["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"].map((grp) => (
                    <button
                      key={grp}
                      type="button"
                      onClick={() => setActiveGroupFilter(grp)}
                      className={`w-8 h-8 shrink-0 rounded-lg font-black text-xs uppercase flex items-center justify-center transition border ${
                        activeGroupFilter === grp ? "bg-[#6b0b0b] text-white border-[#d4af37]/20 shadow" : "bg-stone-900 text-stone-400 border-stone-800"
                      }`}
                    >
                      {grp}
                    </button>
                  ))}
                  <div className="w-4 shrink-0" />
                </div>
              </div>
            </div>

            {/* Interactive Album Index & Flag Viewer */}
            <div className="bg-[#1a0505] rounded-2xl border border-stone-800 p-4 md:p-5 shadow-2xl space-y-4 text-left">
              <div className="flex justify-between items-center border-b border-stone-800/80 pb-3">
                <div className="flex items-center gap-2">
                  <span className="text-[#d4af37] text-lg">📖</span>
                  <h3 className="text-xs md:text-sm font-extrabold uppercase tracking-widest text-stone-200 font-display">
                    Índice Oficial & Mapa de Bandeiras do Álbum
                  </h3>
                </div>
                <button
                  onClick={() => setShowIndex(!showIndex)}
                  className="text-[10px] md:text-xs font-bold text-stone-400 hover:text-stone-100 bg-stone-900 border border-stone-800 px-2.5 py-1.5 rounded-lg smooth-transition"
                >
                  {showIndex ? "Recolher Índice ▵" : "Ver Índice Completo ▿"}
                </button>
              </div>

              {showIndex && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  className="space-y-4 overflow-hidden"
                >
                  <p className="text-[10px] md:text-xs text-stone-500">
                    Clique em qualquer seleção para navegar instantaneamente até a página correspondente no álbum.
                  </p>
                  
                  {/* Desktop Index Grid */}
                  <div className="hidden md:grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-2.5">
                    {countries.map((country) => {
                      let secOwned = 0;
                      let totalStickersSec = 0;

                      country.pages.forEach((p) => {
                        p.stickerIds.forEach((sid) => {
                          totalStickersSec++;
                          if (stickerCounts[sid] >= 1) secOwned++;
                        });
                      });

                      const pct = Math.round((secOwned / totalStickersSec) * 100);
                      const isComplete = pct === 100;

                      return (
                        <button
                          key={country.id}
                          onClick={() => navigateToCountry(country.id, country.group)}
                          className={`flex flex-col justify-between p-2.5 rounded-xl text-left border transition-all hover:scale-[1.03] duration-300 ${
                            isComplete
                              ? "bg-emerald-950/20 border-emerald-500/30 hover:border-emerald-500/60"
                              : "bg-stone-900/40 border-stone-800/80 hover:border-[#d4af37]/30"
                          }`}
                        >
                          <div className="flex items-center gap-1.5 justify-between">
                            <CountryFlag iso2={country.iso2} name={country.name} fifaCode={country.fifaCode} size="sm" />
                            <span className="text-[9px] font-black text-stone-500 uppercase tracking-tight">{country.id}</span>
                          </div>
                          <div className="mt-1.5">
                            <span className="text-[10px] font-bold text-stone-300 truncate block leading-tight">
                              {country.name}
                            </span>
                            <div className="flex items-center justify-between gap-1 mt-1">
                              <div className="w-full bg-stone-950 h-1 rounded-full overflow-hidden">
                                <div
                                  className={`h-full ${isComplete ? "bg-emerald-400" : "bg-[#d4af37]"}`}
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                              <span className={`text-[8px] font-extrabold shrink-0 ${isComplete ? "text-emerald-400" : "text-stone-400"}`}>
                                {pct}%
                              </span>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {/* Mobile Index Grid */}
                  <div className="grid grid-cols-1 xs:grid-cols-2 gap-2 md:hidden">
                    {countries.map((country) => {
                      let secOwned = 0;
                      let totalStickersSec = 0;

                      country.pages.forEach((p) => {
                        p.stickerIds.forEach((sid) => {
                          totalStickersSec++;
                          if (stickerCounts[sid] >= 1) secOwned++;
                        });
                      });

                      const pct = Math.round((secOwned / totalStickersSec) * 100);
                      const isComplete = pct === 100;

                      return (
                        <button
                          key={country.id}
                          type="button"
                          onClick={() => navigateToCountry(country.id, country.group)}
                          className={`flex items-center justify-between p-3.5 rounded-xl text-left border min-h-[48px] ${
                            isComplete
                              ? "bg-emerald-950/20 border-emerald-500/30"
                              : "bg-stone-900/40 border-stone-800/80"
                          }`}
                          aria-label={`Ir para ${country.name}. Progresso: ${pct}%`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <CountryFlag iso2={country.iso2} name={country.name} fifaCode={country.fifaCode} size="sm" />
                            <div className="min-w-0">
                              <span className="text-xs font-bold text-stone-200 truncate block">
                                {country.name}
                              </span>
                              <span className="text-[9px] font-black text-stone-500 block uppercase">
                                {country.id} • {secOwned}/{totalStickersSec}
                              </span>
                            </div>
                          </div>
                          <span className={`text-[10px] font-black ml-2 shrink-0 ${isComplete ? "text-emerald-400" : "text-[#d4af37]"}`}>
                            {pct}%
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </div>

            {/* Render Countries Panels */}
            <div className="space-y-6">
              {countries
                .filter((c) => {
                  if (activeGroupFilter === "all") return true;
                  if (activeGroupFilter === "especiais") return c.special;
                  return c.group === activeGroupFilter;
                })
                .map((country) => {
                  const matchingStickers: string[] = [];

                  country.pages.forEach((page) => {
                    page.stickerIds.forEach((sid) => {
                      const count = stickerCounts[sid] || 0;
                      const isOwned = count >= 1;
                      const isRepeated = count >= 2;

                      if (viewFilter === "missing" && isOwned) return;
                      if (viewFilter === "owned" && !isOwned) return;
                      if (viewFilter === "repeated" && !isRepeated) return;

                      // Match query
                      const matchesSearch =
                        country.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                        country.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
                        sid.toLowerCase().includes(searchQuery.toLowerCase().replace(" ", "_"));

                      if (searchQuery && !matchesSearch) return;

                      matchingStickers.push(sid);
                    });
                  });

                  if (matchingStickers.length === 0) return null;

                  // Stats for this selection
                  let sectionOwned = 0;
                  let totalSecStickers = 0;
                  country.pages.forEach((p) => {
                    p.stickerIds.forEach((sid) => {
                      totalSecStickers++;
                      if (stickerCounts[sid] >= 1) sectionOwned++;
                    });
                  });

                  const missingCount = totalSecStickers - sectionOwned;
                  const pct = Math.round((sectionOwned / totalSecStickers) * 100);

                  return (
                    <motion.div
                      layout
                      initial={{ opacity: 0, scale: 0.98 }}
                      animate={{ opacity: 1, scale: 1 }}
                      key={country.id}
                      id={`country-${country.id}`}
                      className={`bg-[#1a0505] rounded-2xl p-5 shadow-2xl space-y-4 transition-all duration-500 border ${
                        highlightedCountry === country.id
                          ? "border-[#d4af37] ring-4 ring-[#d4af37]/25 scale-[1.01]"
                          : "border-stone-800"
                      }`}
                    >
                      {/* Section Title */}
                      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-stone-800/80 pb-3 gap-2">
                        <div className="flex items-center gap-3">
                          <CountryFlag iso2={country.iso2} name={country.name} fifaCode={country.fifaCode} size="md" />
                          <div className="text-left">
                            <h3 className="text-base font-black text-stone-100 uppercase tracking-wider flex items-center gap-2 font-display">
                              <span>{country.name}</span>
                              <span className="text-[10px] bg-stone-900 text-stone-400 border border-stone-800/60 font-bold px-2 py-0.5 rounded uppercase">
                                {country.special ? "Especial" : `Grupo ${country.group}`}
                              </span>
                            </h3>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 text-xs">
                          <span className={`px-2 py-0.5 rounded border text-[10px] font-black ${
                            pct === 100 ? "bg-emerald-950/80 text-emerald-400 border-emerald-500/20" : "bg-amber-950/80 text-[#d4af37] border-amber-500/20"
                          }`}>
                            {pct}% Completo
                          </span>
                          <span className="bg-stone-900 text-stone-300 border border-stone-800 px-3 py-1 rounded-full text-[11px] font-bold">
                            {missingCount > 0 ? `Restam ${missingCount}` : "Completo! 🏆"}
                          </span>
                        </div>
                      </div>

                      {/* Stickers Grid */}
                      <div className="grid grid-cols-2 xs:grid-cols-3 sm:grid-cols-5 md:grid-cols-8 lg:grid-cols-10 gap-2.5">
                        {matchingStickers.map((stickerId) => {
                          const count = stickerCounts[stickerId] || 0;
                          const isOwned = count >= 1;
                          const isRepeated = count >= 2;
                          const parts = stickerId.split("_");
                          const num = parts[1];

                          // Check if social swap matches
                          const isPerfectGive = viewingFriend && matchTrades.canGive.includes(stickerId);
                          const isPerfectGet = viewingFriend && matchTrades.canGet.includes(stickerId);

                          return (
                            <div
                              key={stickerId}
                              onClick={() => {
                                if (window.innerWidth < 768) {
                                  adjustStickerCount(stickerId, 1);
                                }
                              }}
                              className="relative group rounded-xl overflow-hidden flex flex-col justify-between aspect-square cursor-pointer active:scale-95 transition-transform"
                            >
                              <div
                                className={`w-full h-full pt-2 pb-10 px-1 rounded-xl text-xs md:text-sm font-black border flex flex-col items-center justify-start select-none smooth-transition relative ${
                                  isRepeated
                                    ? "bg-amber-950/60 border-[#d4af37] text-[#d4af37] shadow-lg shadow-amber-950/40"
                                    : isOwned
                                    ? country.special
                                      ? "holographic-shine border-[#d4af37] text-[#1a0505] shadow-md"
                                      : "bg-emerald-950/60 border-emerald-500/80 text-emerald-300 shadow-lg shadow-emerald-950/40"
                                    : "bg-stone-900/40 border-stone-800 border-dashed text-stone-500 hover:border-[#6b0b0b] hover:bg-stone-800/40"
                                } ${
                                  (isPerfectGive || isPerfectGet) ? "perfect-trade-shine ring-2 ring-[#d4af37]" : ""
                                }`}
                              >
                                {isPerfectGive && (
                                  <span className="absolute top-1 left-1 bg-amber-500 text-stone-950 text-[7px] px-1 rounded font-bold animate-pulse">
                                    P/ AMIGO
                                  </span>
                                )}
                                {isPerfectGet && (
                                  <span className="absolute top-1 left-1 bg-teal-500 text-stone-950 text-[7px] px-1 rounded font-bold animate-pulse">
                                    TEM P/ MIM
                                  </span>
                                )}

                                <span className={`block font-bold mt-2 ${isOwned ? "scale-105 text-[#d4af37] md:text-emerald-200" : ""}`}>
                                  {country.fifaCode} {num}
                                </span>

                                <span className="text-[8px] md:text-[9px] mt-0.5 font-extrabold uppercase tracking-wider opacity-80">
                                  {isRepeated ? `Repetida (x${count})` : isOwned ? "Colada" : "Faltando"}
                                </span>

                                {/* Quick Increments and Decrements inside the sticker */}
                                <div className={`absolute inset-x-0 bottom-0 flex items-center justify-between opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity bg-stone-950 border-t border-stone-800/80 p-0.5 ${savingStickerIds.has(stickerId) ? "opacity-50 pointer-events-none" : ""}`}>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      adjustStickerCount(stickerId, -1);
                                    }}
                                    disabled={savingStickerIds.has(stickerId)}
                                    className="p-2 min-h-[36px] min-w-[36px] flex items-center justify-center text-rose-400 hover:text-rose-300 hover:bg-stone-900 rounded-lg smooth-transition cursor-pointer disabled:opacity-50"
                                    title="Diminuir"
                                  >
                                    <Minus className="w-3.5 h-3.5" />
                                  </button>
                                  <span className="text-[10px] text-stone-200 font-mono font-bold select-none">{count}</span>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      adjustStickerCount(stickerId, 1);
                                    }}
                                    disabled={savingStickerIds.has(stickerId)}
                                    className="p-2 min-h-[36px] min-w-[36px] flex items-center justify-center text-emerald-400 hover:text-emerald-300 hover:bg-stone-900 rounded-lg smooth-transition cursor-pointer disabled:opacity-50"
                                    title="Aumentar"
                                  >
                                    <Plus className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </motion.div>
                  );
                })}
            </div>
          </div>
        )}

        {/* VIEW 2: AI SCANNER TAB */}
        {activeTab === "ia" && (
          <div className="bg-[#1a0505] rounded-2xl border border-stone-800 p-6 md:p-8 shadow-2xl space-y-6">
            
            <div className="text-left border-b border-stone-800/80 pb-4">
              <h2 className="text-2xl font-black text-stone-100 uppercase font-display flex items-center gap-2">
                <Camera className="w-6 h-6 text-[#d4af37]" />
                <span>Leitor Inteligente Vision AI</span>
              </h2>
              <p className="text-stone-400 text-sm mt-1 font-sans">
                Selecione a página exata do seu álbum físico, carregue uma foto nítida e deixe a IA identificar as figurinhas coladas. 
                <strong className="text-[#d4af37] block mt-1">Regra de ouro: Você tem direito a 1 leitura válida por ID de página para garantir exatidão!</strong>
              </p>
            </div>

            {/* Multi-state scanner panels */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
              
              {/* Left Column Controls */}
              <div className="lg:col-span-5 space-y-6">
                
                {/* Select Specific Album Page */}
                <div className="space-y-2 text-left">
                  <label className="block text-xs font-black uppercase tracking-wider text-stone-500">
                    Selecione a Página do Álbum
                  </label>
                  <select
                    value={selectedPageId}
                    onChange={(e) => {
                      setSelectedPageId(e.target.value);
                      setScanStatus("available");
                      setReviewStickers([]);
                    }}
                    disabled={scanStatus === "processing" || scanStatus === "uploading" || scanStatus === "saving"}
                    className="w-full px-4 py-3 bg-stone-900 border border-stone-800 rounded-xl outline-none font-bold text-stone-200 focus:border-[#d4af37] transition disabled:opacity-45"
                  >
                    {allPagesList.map((p) => {
                      const countryName = countries.find((c) => c.id === p.countryId)?.name || "";
                      const isDone = completedPages.includes(p.id);
                      return (
                        <option key={p.id} value={p.id}>
                          {isDone ? "🔒 [CONCLUÍDO] " : "📂 "} {countryName} - {p.title}
                        </option>
                      );
                    })}
                  </select>

                  {completedPages.includes(selectedPageId) ? (
                    <div className="bg-rose-950/40 border border-rose-500/30 text-rose-300 text-[11px] rounded-lg p-3 font-semibold mt-2 flex items-start gap-2 animate-pulse">
                      <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                      <span>
                        Você já concluiu a leitura desta página. Novas análises com fotos para este ID estão bloqueadas para seguir a regra de apenas 1 leitura válida por usuário. Você pode continuar modificando as quantidades no álbum manualmente.
                      </span>
                    </div>
                  ) : (
                    <p className="text-[11px] text-stone-500">
                      Disponível para leitura. A IA processará os adesivos: <strong className="text-stone-300">{pagesMap[selectedPageId]?.stickerIds.join(", ")}</strong>.
                    </p>
                  )}
                </div>

                {/* Upload Area */}
                <div
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                  className={`border-2 border-dashed rounded-2xl p-6 text-center smooth-transition cursor-pointer relative ${
                    completedPages.includes(selectedPageId)
                      ? "border-stone-800 bg-stone-900/10 cursor-not-allowed opacity-35"
                      : "border-stone-800 bg-stone-900/30 hover:bg-stone-900 hover:border-[#d4af37]/40"
                  }`}
                >
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleFileChange}
                    disabled={completedPages.includes(selectedPageId) || scanStatus === "processing" || scanStatus === "uploading" || scanStatus === "saving"}
                    className="absolute inset-0 opacity-0 cursor-pointer w-full h-full disabled:cursor-not-allowed"
                    id="album-file-input"
                  />
                  <div className="flex flex-col items-center justify-center space-y-3">
                    <Upload className="w-10 h-10 text-stone-500" />
                    <div>
                      <p className="text-sm font-bold text-stone-300">Arraste a foto ou clique para escolher</p>
                      <p className="text-xs text-stone-500 mt-1">PNG, JPG ou JPEG até 10MB</p>
                    </div>
                    {uploadedFile && (
                      <span className="bg-emerald-950/80 text-emerald-400 border border-emerald-500/20 text-xs font-bold px-3 py-1 rounded-full">
                        {uploadedFile.name}
                      </span>
                    )}
                  </div>
                </div>

                {/* Scan Action Trigger Button */}
                <button
                  onClick={triggerVisionScan}
                  disabled={!uploadedFile || completedPages.includes(selectedPageId) || scanStatus === "processing" || scanStatus === "uploading" || scanStatus === "saving"}
                  className={`w-full py-4 rounded-xl font-black text-sm uppercase tracking-wider flex items-center justify-center gap-2 smooth-transition ${
                    !uploadedFile || completedPages.includes(selectedPageId)
                      ? "bg-stone-900 text-stone-600 border border-stone-800/80 cursor-not-allowed"
                      : "bg-[#6b0b0b] hover:bg-[#8f1212] border border-[#d4af37]/30 text-white shadow-lg active:scale-95"
                  }`}
                >
                  <Sparkles className="w-4 h-4 text-[#d4af37]" />
                  <span>
                    {scanStatus === "uploading" ? "Enviando imagem..." :
                     scanStatus === "processing" ? "Gemini está lendo..." :
                     "Analisar com Gemini Vision"}
                  </span>
                </button>

              </div>

              {/* Right Column: Previews and Interactive Review display */}
              <div className="lg:col-span-7 flex flex-col justify-center bg-stone-900/10 rounded-2xl p-6 border border-stone-800 min-h-[300px]">
                
                {(scanStatus === "uploading" || scanStatus === "processing" || scanStatus === "saving") && (
                  <div className="flex flex-col items-center justify-center space-y-4 py-12 animate-pulse">
                    <div className="w-12 h-12 border-4 border-[#6b0b0b] border-t-transparent rounded-full animate-spin" />
                    <div className="text-center">
                      <p className="text-sm font-black text-[#d4af37] uppercase tracking-wider">
                        {scanStatus === "uploading" ? "Subindo fotografia..." :
                         scanStatus === "processing" ? "Vision AI analisando..." :
                         "Salvando em lote no Firestore..."}
                      </p>
                      <p className="text-xs text-stone-500 mt-1">A IA está comparando as colagens com alta sensibilidade.</p>
                    </div>
                  </div>
                )}

                {scanStatus === "failed" && (
                  <div className="flex flex-col items-center justify-center space-y-3 text-center py-12">
                    <AlertCircle className="w-12 h-12 text-rose-500" />
                    <h3 className="font-bold text-stone-300">Falha no Processamento</h3>
                    <p className="text-xs text-stone-500 max-w-md">{scanErrorMsg}</p>
                    <button
                      onClick={() => setScanStatus("available")}
                      className="mt-3 px-4 py-2 bg-stone-900 text-stone-300 rounded-lg text-xs font-bold border border-stone-800 hover:bg-stone-800"
                    >
                      Tentar Novamente
                    </button>
                  </div>
                )}

                {scanStatus === "available" && previewUrl && (
                  <div className="space-y-4">
                    <p className="text-xs font-bold uppercase tracking-wider text-stone-500 text-left">Foto Carregada</p>
                    <div className="relative rounded-xl overflow-hidden shadow-inner max-h-[350px]">
                      <img src={previewUrl} alt="Preview" className="w-full h-full object-contain bg-stone-950 rounded-xl" />
                    </div>
                  </div>
                )}

                {scanStatus === "available" && !previewUrl && (
                  <div className="flex flex-col items-center justify-center text-center space-y-3 py-12 text-stone-500">
                    <HelpCircle className="w-12 h-12 text-stone-600" />
                    <div>
                      <p className="font-bold text-sm text-stone-400">Nenhum resultado de análise ativo</p>
                      <p className="text-xs text-stone-500">Faça upload ou tire uma foto para obter a verificação inteligente.</p>
                    </div>
                  </div>
                )}

                {/* HIGH-FIDELITY INTERACTIVE REVIEW SCREEN */}
                {scanStatus === "reviewing" && reviewStickers.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="space-y-6 text-left"
                  >
                    <div className="bg-amber-950/20 border border-[#d4af37]/30 rounded-xl p-4">
                      <h4 className="text-xs font-black text-[#d4af37] uppercase tracking-wider flex items-center gap-1.5 border-b border-stone-800/80 pb-2">
                        <Sparkles className="w-4 h-4 text-[#d4af37]" />
                        <span>Revisão de Deteções Inteligentes - {pagesMap[selectedPageId]?.title}</span>
                      </h4>
                      <p className="text-[11px] text-stone-400 mt-2">
                        Verifique o status sugerido para cada espaço. Marque/desmarque as caixas de seleção antes de confirmar na sua conta permanentemente.
                      </p>
                    </div>

                    {scanWarnings.length > 0 && (
                      <div className="bg-amber-950/35 border border-amber-500/30 rounded-xl p-3 text-xs text-amber-400 space-y-1">
                        <p className="font-bold">Avisos da IA:</p>
                        <ul className="list-disc pl-4 space-y-0.5">
                          {scanWarnings.map((w, idx) => (
                            <li key={idx}>{w}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div className="max-h-[320px] overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                      {reviewStickers.map((item) => {
                        const parts = item.id.split("_");
                        const num = parts[1];

                        return (
                          <div
                            key={item.id}
                            onClick={() => handleToggleReviewSticker(item.id)}
                            className={`flex items-center justify-between p-2.5 rounded-xl border smooth-transition cursor-pointer ${
                              item.confirmed
                                ? "bg-emerald-950/20 border-emerald-500/40"
                                : "bg-stone-900/40 border-stone-850"
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <div
                                className={`w-10 h-7 rounded font-black text-[10px] flex items-center justify-center ${
                                  item.type === "owned"
                                    ? "bg-stone-800 text-stone-400"
                                    : item.type === "detected"
                                    ? "bg-emerald-900 text-emerald-300"
                                    : item.type === "uncertain"
                                    ? "bg-amber-950 text-amber-300 border border-amber-500/30"
                                    : "bg-stone-950 text-stone-600"
                                }`}
                              >
                                {parts[0]} {num}
                              </div>
                              <div>
                                <span className="text-xs font-bold text-stone-200 block">{item.label}</span>
                                <span className="text-[9px] font-semibold uppercase tracking-widest text-stone-500">
                                  {item.type === "owned" ? "Já possuída (Inalterada)" :
                                   item.type === "detected" ? "✨ Detectada com Alta Certeza" :
                                   item.type === "uncertain" ? `⚠️ Em dúvida: ${item.reason}` :
                                   "Em branco (Não colada)"}
                                </span>
                              </div>
                            </div>
                            <input
                              type="checkbox"
                              checked={item.confirmed}
                              readOnly
                              className="w-4.5 h-4.5 accent-emerald-500 cursor-pointer"
                            />
                          </div>
                        );
                      })}
                    </div>

                    <div className="flex gap-3">
                      <button
                        onClick={applyScanResult}
                        className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white border border-emerald-500/30 py-3 rounded-xl text-xs uppercase font-extrabold tracking-widest smooth-transition shadow"
                      >
                        Salvar e Consumir Leitura
                      </button>
                      <button
                        onClick={handleDiscardScan}
                        className="px-4 py-3 border border-stone-800 text-stone-400 rounded-xl text-xs uppercase font-bold hover:bg-stone-900 smooth-transition"
                      >
                        Descartar
                      </button>
                    </div>
                  </motion.div>
                )}

              </div>

            </div>

          </div>
        )}

        {/* VIEW 3: STATS TAB */}
        {activeTab === "stats" && (
          <div className="space-y-6">
            
            {/* Top Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              
              <div className="bg-[#1a0505] border border-stone-800 rounded-2xl p-6 shadow-2xl flex flex-col justify-between">
                <div>
                  <h3 className="text-stone-500 font-extrabold uppercase text-[10px] tracking-wider">País Mais Completo</h3>
                  <p className="text-2xl font-black text-emerald-400 mt-2 font-display">{statsInsights.bestTeam}</p>
                </div>
                <p className="text-xs text-stone-500 mt-4 font-sans">A seleção na qual você reuniu mais figurinhas até agora.</p>
              </div>

              <div className="bg-[#1a0505] border border-stone-800 rounded-2xl p-6 shadow-2xl flex flex-col justify-between">
                <div>
                  <h3 className="text-stone-500 font-extrabold uppercase text-[10px] tracking-wider">Grupo Mais Próximo</h3>
                  <p className="text-2xl font-black text-[#d4af37] mt-2 font-display">{statsInsights.bestGroup}</p>
                </div>
                <p className="text-xs text-stone-500 mt-4 font-sans">O grupo mais próximo de completar todas as figurinhas.</p>
              </div>

              <div className="bg-[#1a0505] border border-stone-800 rounded-2xl p-6 shadow-2xl flex flex-col justify-between">
                <div>
                  <h3 className="text-stone-500 font-extrabold uppercase text-[10px] tracking-wider">Status do Colecionador</h3>
                  <p className="text-2xl font-black text-rose-400 mt-2 font-display">{statsInsights.rank}</p>
                </div>
                <p className="text-xs text-stone-500 mt-4 font-sans">Sua categoria atualizada dinamicamente com base no seu preenchimento.</p>
              </div>

            </div>

            {/* Detailed countries progression */}
            <div className="bg-[#1a0505] border border-stone-800 rounded-2xl p-6 shadow-2xl">
              <h3 className="text-lg font-black text-stone-100 uppercase tracking-wide mb-6 border-b border-stone-800 pb-3 flex items-center gap-2 font-display">
                <TrendingUp className="w-5 h-5 text-[#d4af37]" />
                <span>Estatísticas por Seleção</span>
              </h3>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {countries.map((country) => {
                  let countOwned = 0;
                  let totalSecStickers = 0;

                  country.pages.forEach((p) => {
                    p.stickerIds.forEach((sid) => {
                      totalSecStickers++;
                      if (stickerCounts[sid] >= 1) countOwned++;
                    });
                  });

                  const pct = Math.round((countOwned / totalSecStickers) * 100);

                  return (
                    <div key={country.id} className="bg-stone-900 border border-stone-800/80 rounded-xl p-4 flex flex-col justify-between text-left">
                      <div className="flex justify-between items-start mb-2">
                        <span className="font-bold text-sm text-stone-300">{country.name}</span>
                        <span className="text-xs font-black text-[#d4af37]">{pct}%</span>
                      </div>
                      <div className="w-full bg-stone-950 h-2 rounded-full overflow-hidden border border-stone-800/55">
                        <div className="bg-[#6b0b0b] h-full" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-[10px] text-stone-500 font-bold block mt-2 text-right">
                        {countOwned} de {totalSecStickers} coladas
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Backup & System reset panel */}
            <div className="bg-[#1a0505] border border-stone-800 text-stone-200 rounded-2xl p-6 shadow-2xl space-y-4 text-left">
              <h3 className="text-lg font-black text-amber-400 uppercase tracking-wide font-display">⚙️ Gerenciamento Técnico do Álbum</h3>
              <p className="text-xs text-stone-500 font-sans">
                Gerencie seus códigos de backup locais, restaure dados de fotos de teste offline ou redefina o progresso total de forma segura.
              </p>
              <div className="flex flex-wrap gap-3 pt-2">
                <button
                  onClick={exportStateCode}
                  className="bg-stone-900 hover:bg-stone-800 border border-stone-800 text-stone-300 text-xs font-bold uppercase px-4 py-3 rounded-xl transition cursor-pointer"
                >
                  📥 Exportar Backup
                </button>
                <button
                  onClick={importStateCode}
                  className="bg-stone-900 hover:bg-stone-800 border border-stone-800 text-stone-300 text-xs font-bold uppercase px-4 py-3 rounded-xl transition cursor-pointer"
                >
                  📤 Importar Backup
                </button>
                <button
                  onClick={resetToPhotos}
                  className="bg-amber-600/90 hover:bg-amber-700 text-white text-xs font-bold uppercase px-4 py-3 rounded-xl transition cursor-pointer"
                >
                  📸 Restaurar Fotos Originais
                </button>
                <button
                  onClick={clearProgressTotal}
                  className="bg-rose-700/90 hover:bg-rose-800 text-white text-xs font-bold uppercase px-4 py-3 rounded-xl transition cursor-pointer"
                >
                  🚨 Zerar Tudo
                </button>
              </div>
            </div>

          </div>
        )}

        {/* VIEW 4: SOCIAL EXCHANGE TABS */}
        {activeTab === "social" && (
          <div className="bg-[#1a0505] rounded-2xl border border-stone-800 p-6 md:p-8 shadow-2xl space-y-6">
            
            <div className="text-left border-b border-stone-800/80 pb-4">
              <h2 className="text-2xl font-black text-stone-100 uppercase font-display flex items-center gap-2">
                <Users className="w-6 h-6 text-[#d4af37]" />
                <span>Painel Social de Trocas de Figurinhas</span>
              </h2>
              <p className="text-stone-400 text-sm mt-1 font-sans">
                Crie seu código único de trocas, envie para seus amigos de colecionismo e cruze as listas em tempo real para encontrar figurinhas repetidas compatíveis com brilho holográfico dourado automático!
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 text-left">
              
              {/* Left Column: My Sharing Links */}
              <div className="bg-stone-900/30 rounded-2xl p-6 border border-stone-800/80 space-y-5">
                <h3 className="font-black text-stone-200 uppercase text-sm tracking-wider flex items-center gap-1.5 font-display">
                  <Share2 className="w-4 h-4 text-[#d4af37]" />
                  <span>Meus Códigos de Troca</span>
                </h3>

                {myShareId ? (
                  <div className="space-y-3">
                    <p className="text-xs text-stone-500">Seu código de troca gerado e ativo:</p>
                    <div className="flex bg-stone-950 border border-stone-800 rounded-xl p-3 items-center justify-between shadow-inner">
                      <span className="font-mono font-black text-[#d4af37] text-lg tracking-widest">{myShareId}</span>
                      <button
                        onClick={() => {
                          const url = `${window.location.origin}${window.location.pathname}?share=${myShareId}`;
                          navigator.clipboard.writeText(url);
                          showToast("Link de comparação copiado!", "success");
                        }}
                        className="bg-[#6b0b0b] hover:bg-[#8f1212] border border-[#d4af37]/20 text-white px-3 py-1.5 rounded-lg text-xs font-bold uppercase smooth-transition"
                      >
                        Copiar Link
                      </button>
                    </div>
                    <div className="flex justify-end">
                      <button
                        onClick={disableMyShare}
                        className="text-[10px] text-rose-500 hover:text-rose-400 uppercase font-bold tracking-widest"
                      >
                        Desativar Código
                      </button>
                    </div>
                    <p className="text-[11px] text-stone-500">
                      Envie o link para que seus amigos vejam o que vocês têm para trocar em tempo real lado a lado.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-xs text-stone-500 font-sans">Você ainda não tem um link de compartilhamento ativo.</p>
                    <button
                      onClick={generateMyShareLink}
                      disabled={generatingShare}
                      className="bg-[#6b0b0b] hover:bg-[#8f1212] border border-[#d4af37]/20 text-white px-5 py-3 rounded-xl text-xs font-bold uppercase tracking-wider smooth-transition shadow flex items-center gap-1.5 cursor-pointer"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-[#d4af37]" />
                      <span>{generatingShare ? "Gerando..." : "Gerar Link Compartilhável"}</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Right Column: Load Friend Shared Code */}
              <div className="bg-stone-900/30 rounded-2xl p-6 border border-stone-800/80 space-y-4">
                <h3 className="font-black text-stone-200 uppercase text-sm tracking-wider flex items-center gap-1.5 font-display">
                  <Users className="w-4 h-4 text-[#d4af37]" />
                  <span>Cruzar Lista de Amigo</span>
                </h3>

                <div className="space-y-3">
                  <p className="text-xs text-stone-500 font-sans">Cole o código curto ou link de trocas do seu amigo:</p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Ex: H4CK3R_X"
                      value={friendShareId}
                      onChange={(e) => setFriendShareId(e.target.value)}
                      className="flex-1 px-4 py-2.5 bg-stone-950 border border-stone-850 rounded-xl outline-none font-mono text-xs uppercase text-stone-100 placeholder-stone-600 focus:border-[#d4af37]"
                    />
                    <button
                      onClick={() => loadFriendShare(friendShareId)}
                      disabled={loadingFriend}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 border border-emerald-500/20 rounded-xl text-xs font-bold uppercase smooth-transition shrink-0 cursor-pointer"
                    >
                      {loadingFriend ? "Buscando..." : "Cruzar Listas"}
                    </button>
                  </div>
                </div>
              </div>

            </div>

            {/* Algorithm Match Display */}
            {viewingFriend && friendProfile && (
              <motion.div
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-[#1a0505] border border-[#d4af37]/30 rounded-2xl p-6 space-y-6 text-left shadow-2xl"
              >
                
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between border-b border-stone-800/80 pb-3 gap-2">
                  <h3 className="text-base font-black text-[#d4af37] uppercase font-display flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-amber-500 animate-spin" style={{ animationDuration: "12s" }} />
                    <span>⚡ Algoritmo de Matches de Troca Ideais</span>
                  </h3>
                  <div className="flex items-center gap-1 text-xs">
                    <span className="bg-[#6b0b0b] text-white border border-[#d4af37]/25 font-black px-2 py-0.5 rounded uppercase text-[9px]">
                      Holograma Ativo
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  
                  {/* Give: O que posso te dar */}
                  <div className="bg-stone-900 rounded-xl border border-stone-800 p-4 shadow-2xl">
                    <p className="text-xs font-black text-rose-400 uppercase tracking-wider border-b border-stone-800 pb-2">
                      🎁 O que posso dar para {friendProfile.name}:
                    </p>
                    {matchTrades.canGive.length > 0 ? (
                      <div className="flex flex-wrap gap-2 mt-3">
                        {matchTrades.canGive.map((id) => (
                          <span
                            key={id}
                            className="perfect-trade-shine text-stone-950 text-xs font-black px-3 py-1.5 rounded-xl flex items-center gap-1 border border-amber-400 shadow-md animate-pulse"
                          >
                            <Sparkles className="w-3.5 h-3.5 text-stone-950" />
                            <span>{id.replace("_", " ")}</span>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-stone-500 mt-4 italic font-sans">Nenhuma figurinha repetida minha serve para o álbum dele de momento.</p>
                    )}
                  </div>

                  {/* Get: O que posso receber */}
                  <div className="bg-stone-900 rounded-xl border border-stone-800 p-4 shadow-2xl">
                    <p className="text-xs font-black text-emerald-400 uppercase tracking-wider border-b border-stone-800 pb-2">
                      🔮 O que {friendProfile.name} pode me dar:
                    </p>
                    {matchTrades.canGet.length > 0 ? (
                      <div className="flex flex-wrap gap-2 mt-3">
                        {matchTrades.canGet.map((id) => (
                          <span
                            key={id}
                            className="perfect-trade-shine text-stone-950 text-xs font-black px-3 py-1.5 rounded-xl flex items-center gap-1 border border-amber-400 shadow-md animate-pulse"
                          >
                            <Sparkles className="w-3.5 h-3.5 text-stone-950" />
                            <span>{id.replace("_", " ")}</span>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-stone-500 mt-4 italic font-sans">Ele não possui nenhuma repetida que esteja faltando no meu álbum.</p>
                    )}
                  </div>

                </div>

                {matchTrades.canGive.length > 0 && matchTrades.canGet.length > 0 ? (
                  <div className="bg-emerald-950/20 border border-emerald-500/25 p-4 rounded-xl flex items-center gap-3">
                    <Sparkles className="w-6 h-6 text-[#d4af37]" />
                    <p className="text-xs font-bold text-emerald-300 font-sans">
                      <strong>Troca Bilateral Perfeita Disponível!</strong> Vocês têm figurinhas repetidas compatíveis. Combine o encontro para realizar a troca física!
                    </p>
                  </div>
                ) : (
                  <p className="text-[11px] text-stone-500 italic text-center font-sans">
                    Cruze dados com outros amigos e encontre a compatibilidade perfeita.
                  </p>
                )}

              </motion.div>
            )}

          </div>
        )}

      </main>

      {/* Mobile Fixed Bottom Navigation Bar */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-[#1a0505] border-t border-stone-800 px-4 py-2 z-40 flex items-center justify-around shadow-lg">
        <button
          onClick={() => { setActiveTab("album"); setViewingFriend(false); }}
          className={`flex flex-col items-center gap-1 py-1 px-3 rounded-lg text-[10px] font-black uppercase tracking-wider smooth-transition min-h-[44px] justify-center ${
            activeTab === "album" && !viewingFriend ? "text-[#d4af37]" : "text-stone-400"
          }`}
        >
          <span className="text-lg">📖</span>
          <span>Álbum</span>
        </button>

        <button
          onClick={() => { setActiveTab("ia"); setViewingFriend(false); }}
          className={`flex flex-col items-center gap-1 py-1 px-3 rounded-lg text-[10px] font-black uppercase tracking-wider smooth-transition min-h-[44px] justify-center ${
            activeTab === "ia" && !viewingFriend ? "text-[#d4af37]" : "text-stone-400"
          }`}
        >
          <Camera className="w-4 h-4" />
          <span>Escanear</span>
        </button>

        <button
          onClick={() => { setActiveTab("stats"); setViewingFriend(false); }}
          className={`flex flex-col items-center gap-1 py-1 px-3 rounded-lg text-[10px] font-black uppercase tracking-wider smooth-transition min-h-[44px] justify-center ${
            activeTab === "stats" && !viewingFriend ? "text-[#d4af37]" : "text-stone-400"
          }`}
        >
          <TrendingUp className="w-4 h-4" />
          <span>Stats</span>
        </button>

        <button
          onClick={() => { setActiveTab("social"); }}
          className={`flex flex-col items-center gap-1 py-1 px-3 rounded-lg text-[10px] font-black uppercase tracking-wider smooth-transition min-h-[44px] justify-center ${
            activeTab === "social" || viewingFriend ? "text-[#d4af37]" : "text-stone-400"
          }`}
        >
          <Users className="w-4 h-4" />
          <span>Trocas</span>
        </button>
      </div>

    </div>
  );
}
