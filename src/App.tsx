import React, { useState, useEffect, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Award, Camera, Share2, Users, Copy, RefreshCw, LogOut, LogIn,
  CheckCircle, Plus, Minus, Sparkles, TrendingUp, Info, HelpCircle,
  Search, Filter, ChevronRight, Check, AlertCircle, FileText, ArrowRight,
  Upload, X, CheckSquare, Square
} from "lucide-react";
import {
  db, auth, googleProvider, signInWithPopup, signOut,
  handleFirestoreError, OperationType
} from "./firebase";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, setDoc, onSnapshot, collection, addDoc, serverTimestamp } from "firebase/firestore";
import { missingFromPhotos, albumSections, totalAlbumStickers, TOTAL_STICKERS } from "./data";
import { UserProfile, UserAlbum, TradeShare, ActivityLog } from "./types";

export default function App() {
  // Auth State
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loadingAuth, setLoadingAuth] = useState(true);

  // Active Navigation Tab
  const [activeTab, setActiveTab] = useState<"album" | "ia" | "stats" | "social">("album");

  // Local album states
  const [ownedStickers, setOwnedStickers] = useState<string[]>([]);
  const [repeatedStickers, setRepeatedStickers] = useState<string[]>([]);
  const [loadingAlbum, setLoadingAlbum] = useState(false);

  // Filters and UI controls
  const [searchQuery, setSearchQuery] = useState("");
  const [viewFilter, setViewFilter] = useState<"all" | "missing" | "owned" | "repeated">("all");
  const [activeGroupFilter, setActiveGroupFilter] = useState<string>("all");
  const [showIndex, setShowIndex] = useState(true);
  const [highlightedCountry, setHighlightedCountry] = useState<string | null>(null);

  // Share system states
  const [myShareId, setMyShareId] = useState<string | null>(null);
  const [generatingShare, setGeneratingShare] = useState(false);
  const [friendShareId, setFriendShareId] = useState("");
  
  // Friend swap matchup states (when viewing a shared link)
  const [viewingFriend, setViewingFriend] = useState(false);
  const [friendProfile, setFriendProfile] = useState<UserProfile | null>(null);
  const [friendAlbum, setFriendAlbum] = useState<UserAlbum | null>(null);
  const [loadingFriend, setLoadingFriend] = useState(false);

  // IA Vision states
  const [selectedPrefix, setSelectedPrefix] = useState("BRA");
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<{
    prefix: string;
    filled: number[];
    empty: number[];
  } | null>(null);

  // Activity logs
  const [activities, setActivities] = useState<ActivityLog[]>([]);

  // Toast state
  const [toast, setToast] = useState<{ message: string; type: "success" | "warn" | "error" | "info" } | null>(null);

  const showToast = (message: string, type: "success" | "warn" | "error" | "info" = "success") => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(null);
    }, 4000);
  };

  // 1. Listen for Auth State changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        // Sync user profile
        const userDocRef = doc(db, "users", currentUser.uid);
        try {
          const userSnap = await getDoc(userDocRef);
          let userProfile: UserProfile;
          if (!userSnap.exists()) {
            userProfile = {
              uid: currentUser.uid,
              name: currentUser.displayName || "Colecionador",
              email: currentUser.email || "",
              photoURL: currentUser.photoURL || "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&q=80",
              createdAt: new Date().toISOString()
            };
            await setDoc(userDocRef, userProfile);
          } else {
            userProfile = userSnap.data() as UserProfile;
          }
          setProfile(userProfile);

          // Listen in real-time to this user's album
          const albumDocRef = doc(db, "albums", currentUser.uid);
          const unsubAlbum = onSnapshot(albumDocRef, (albumSnap) => {
            if (albumSnap.exists()) {
              const albumData = albumSnap.data() as UserAlbum;
              setOwnedStickers(albumData.ownedStickers || []);
              setRepeatedStickers(albumData.repeatedStickers || []);
              localStorage.setItem("copa2026_owned", JSON.stringify(albumData.ownedStickers || []));
              localStorage.setItem("copa2026_repeated", JSON.stringify(albumData.repeatedStickers || []));
            } else {
              // Create default from localStorage or default image state
              initializeDefaultAlbum(currentUser.uid);
            }
          }, (err) => {
            handleFirestoreError(err, OperationType.GET, `albums/${currentUser.uid}`);
          });

          // Fetch or generate an initial share record
          fetchUserShare(currentUser.uid);

          setLoadingAuth(false);
          return () => {
            unsubAlbum();
          };
        } catch (error) {
          console.error("Auth sync error:", error);
          setLoadingAuth(false);
        }
      } else {
        setProfile(null);
        setLoadingAuth(false);
        // Load from local storage for offline guest mode
        const savedOwned = localStorage.getItem("copa2026_owned");
        const savedRepeated = localStorage.getItem("copa2026_repeated");
        if (savedOwned) setOwnedStickers(JSON.parse(savedOwned));
        else generateInitialPhotoStateLocal();

        if (savedRepeated) setRepeatedStickers(JSON.parse(savedRepeated));
      }
    });

    return () => unsubscribe();
  }, []);

  // Check URL parameters for Friend Share IDs on startup
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const shareId = params.get("share");
    if (shareId) {
      setFriendShareId(shareId);
      loadFriendShare(shareId);
    }
  }, []);

  const navigateToCountry = (id: string, group: string) => {
    // Set group filter to "all" to make sure the selected country is visible
    setActiveGroupFilter("all");
    
    // Set highlighted state
    setHighlightedCountry(id);
    setTimeout(() => {
      setHighlightedCountry(null);
    }, 2000);

    // Scroll smoothly to target element
    setTimeout(() => {
      const element = document.getElementById(`country-${id}`);
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 150);
  };

  const fetchUserShare = async (userId: string) => {
    try {
      // Find if they already have a share token
      const shareDocRef = doc(db, "trade_shares", userId);
      const shareSnap = await getDoc(shareDocRef);
      if (shareSnap.exists()) {
        setMyShareId(shareSnap.data().shareId);
      }
    } catch (e) {
      console.warn("Share retrieval skipped:", e);
    }
  };

  const initializeDefaultAlbum = async (userId: string) => {
    setLoadingAlbum(true);
    // Prefer matching what we have in localStorage
    const localSavedOwned = localStorage.getItem("copa2026_owned");
    const localSavedRepeated = localStorage.getItem("copa2026_repeated");

    let initialOwned: string[] = [];
    if (localSavedOwned) {
      initialOwned = JSON.parse(localSavedOwned);
    } else {
      // Fill from default photos
      initialOwned = totalAlbumStickers.filter((id) => {
        const [prefix, numStr] = id.split("_");
        const num = parseInt(numStr, 10);
        const missingList = missingFromPhotos[prefix];
        if (!missingList) return true;
        return !missingList.includes(num);
      });
    }

    const initialRepeated: string[] = localSavedRepeated ? JSON.parse(localSavedRepeated) : [];
    
    const albumData: UserAlbum = {
      userId,
      ownedStickers: initialOwned,
      repeatedStickers: initialRepeated,
      lastUpdated: new Date().toISOString(),
      progressPercent: Math.round((initialOwned.length / TOTAL_STICKERS) * 100)
    };

    try {
      await setDoc(doc(db, "albums", userId), albumData);
      setOwnedStickers(initialOwned);
      setRepeatedStickers(initialRepeated);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `albums/${userId}`);
    } finally {
      setLoadingAlbum(false);
    }
  };

  const generateInitialPhotoStateLocal = () => {
    const initialOwned = totalAlbumStickers.filter((id) => {
      const [prefix, numStr] = id.split("_");
      const num = parseInt(numStr, 10);
      const missingList = missingFromPhotos[prefix];
      if (!missingList) return true;
      return !missingList.includes(num);
    });
    setOwnedStickers(initialOwned);
    localStorage.setItem("copa2026_owned", JSON.stringify(initialOwned));
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
      setMyShareId(null);
      setViewingFriend(false);
      setFriendAlbum(null);
      setFriendProfile(null);
      showToast("Desconectado do Firebase.", "info");
    } catch (error) {
      showToast("Erro ao desconectar.", "error");
    }
  };

  // Toggle Sticker State (Owned vs Repeated vs Missing)
  const toggleStickerState = async (stickerId: string) => {
    const isOwned = ownedStickers.includes(stickerId);
    const isRepeated = repeatedStickers.includes(stickerId);

    let nextOwned = [...ownedStickers];
    let nextRepeated = [...repeatedStickers];

    if (!isOwned) {
      // Missing -> Owned
      nextOwned.push(stickerId);
      showToast(`Figurinha ${stickerId.replace("_", " ")} colada!`, "success");
    } else if (isOwned && !isRepeated) {
      // Owned -> Repeated
      nextRepeated.push(stickerId);
      showToast(`Figurinha ${stickerId.replace("_", " ")} marcada como repetida!`, "info");
    } else {
      // Repeated -> Missing
      nextOwned = nextOwned.filter((id) => id !== stickerId);
      nextRepeated = nextRepeated.filter((id) => id !== stickerId);
      showToast(`Figurinha ${stickerId.replace("_", " ")} removida.`, "warn");
    }

    setOwnedStickers(nextOwned);
    setRepeatedStickers(nextRepeated);
    
    // Save locally
    localStorage.setItem("copa2026_owned", JSON.stringify(nextOwned));
    localStorage.setItem("copa2026_repeated", JSON.stringify(nextRepeated));

    // Push to Firestore if logged in
    if (user) {
      try {
        const albumData: UserAlbum = {
          userId: user.uid,
          ownedStickers: nextOwned,
          repeatedStickers: nextRepeated,
          lastUpdated: new Date().toISOString(),
          progressPercent: Math.round((nextOwned.length / TOTAL_STICKERS) * 100)
        };
        await setDoc(doc(db, "albums", user.uid), albumData);
      } catch (err) {
        console.error("Error saving album change:", err);
      }
    }
  };

  const quickMarkMissing = async (stickerId: string) => {
    // Force sticker back to missing state directly
    const nextOwned = ownedStickers.filter(id => id !== stickerId);
    const nextRepeated = repeatedStickers.filter(id => id !== stickerId);

    setOwnedStickers(nextOwned);
    setRepeatedStickers(nextRepeated);
    localStorage.setItem("copa2026_owned", JSON.stringify(nextOwned));
    localStorage.setItem("copa2026_repeated", JSON.stringify(nextRepeated));

    if (user) {
      try {
        await setDoc(doc(db, "albums", user.uid), {
          userId: user.uid,
          ownedStickers: nextOwned,
          repeatedStickers: nextRepeated,
          lastUpdated: new Date().toISOString(),
          progressPercent: Math.round((nextOwned.length / TOTAL_STICKERS) * 100)
        });
      } catch (e) {
        console.error(e);
      }
    }
    showToast(`Figurinha ${stickerId.replace("_", " ")} desmarcada.`, "warn");
  };

  // AI Scanning handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      setUploadedFile(file);
      setPreviewUrl(URL.createObjectURL(file));
      setScanResult(null);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setUploadedFile(file);
      setPreviewUrl(URL.createObjectURL(file));
      setScanResult(null);
    }
  };

  const triggerVisionScan = async () => {
    if (!uploadedFile) {
      showToast("Selecione ou tire uma foto primeiro.", "warn");
      return;
    }

    setScanning(true);
    setScanResult(null);

    const formData = new FormData();
    formData.append("image", uploadedFile);
    formData.append("prefix", selectedPrefix);

    try {
      const response = await fetch("/api/gemini/analyze", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error("Erro de processamento da IA.");
      }

      const data = await response.json();
      setScanResult(data);
      showToast("Página escaneada com sucesso pela Visão Artificial!", "success");
    } catch (error) {
      console.error(error);
      showToast("Falha no escaneamento automático da página.", "error");
    } finally {
      setScanning(false);
    }
  };

  const applyScanResult = async () => {
    if (!scanResult) return;

    // Merge scan results with user owned/missing lists
    const { prefix, filled, empty } = scanResult;

    let nextOwned = [...ownedStickers];
    let nextRepeated = [...repeatedStickers];

    // For all 20 stickers of this prefix, if listed in filled: make sure it's in owned
    filled.forEach((num) => {
      const stickerId = `${prefix}_${num}`;
      if (!nextOwned.includes(stickerId)) {
        nextOwned.push(stickerId);
      }
    });

    // If listed in empty: remove from owned and repeated
    empty.forEach((num) => {
      const stickerId = `${prefix}_${num}`;
      nextOwned = nextOwned.filter((id) => id !== stickerId);
      nextRepeated = nextRepeated.filter((id) => id !== stickerId);
    });

    setOwnedStickers(nextOwned);
    setRepeatedStickers(nextRepeated);

    localStorage.setItem("copa2026_owned", JSON.stringify(nextOwned));
    localStorage.setItem("copa2026_repeated", JSON.stringify(nextRepeated));

    // Save online
    if (user) {
      try {
        await setDoc(doc(db, "albums", user.uid), {
          userId: user.uid,
          ownedStickers: nextOwned,
          repeatedStickers: nextRepeated,
          lastUpdated: new Date().toISOString(),
          progressPercent: Math.round((nextOwned.length / TOTAL_STICKERS) * 100)
        });

        // Add to activities
        await addDoc(collection(db, "activity_logs"), {
          userId: user.uid,
          type: "stickers_added",
          description: `Escaneou página do país ${prefix} usando Visão Computacional.`,
          timestamp: new Date().toISOString()
        });

      } catch (err) {
        console.error(err);
      }
    }

    showToast(`Lista sincronizada para a seleção ${prefix}!`, "success");
    setScanResult(null);
    setUploadedFile(null);
    setPreviewUrl(null);
    setActiveTab("album");
    setActiveGroupFilter(albumSections.find(s => s.prefix === prefix)?.group || "all");
  };

  // Social Sharing Link Generator
  const generateMyShareLink = async () => {
    if (!user) {
      showToast("Faça login com Google para compartilhar online.", "warn");
      return;
    }

    setGeneratingShare(true);
    const newShareId = Math.random().toString(36).substring(2, 10).toUpperCase();

    try {
      const shareDoc: TradeShare = {
        shareId: newShareId,
        userId: user.uid,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        isPublic: true
      };

      await setDoc(doc(db, "trade_shares", newShareId), shareDoc);
      setMyShareId(newShareId);
      showToast("Link de trocas ativo por 30 dias!", "success");
    } catch (e) {
      console.error(e);
      showToast("Falha ao criar link de compartilhamento.", "error");
    } finally {
      setGeneratingShare(false);
    }
  };

  const loadFriendShare = async (shareIdToLoad: string) => {
    if (!shareIdToLoad.trim()) return;
    setLoadingFriend(true);
    setViewingFriend(false);

    try {
      // 1. Fetch trade share reference
      const shareSnap = await getDoc(doc(db, "trade_shares", shareIdToLoad.trim().toUpperCase()));
      if (!shareSnap.exists()) {
        showToast("Código de troca expirado ou inexistente.", "error");
        setLoadingFriend(false);
        return;
      }

      const shareData = shareSnap.data() as TradeShare;
      const friendUid = shareData.userId;

      // 2. Fetch Friend Profile
      const friendProfileSnap = await getDoc(doc(db, "users", friendUid));
      if (friendProfileSnap.exists()) {
        setFriendProfile(friendProfileSnap.data() as UserProfile);
      }

      // 3. Fetch Friend Album
      const friendAlbumSnap = await getDoc(doc(db, "albums", friendUid));
      if (friendAlbumSnap.exists()) {
        setFriendAlbum(friendAlbumSnap.data() as UserAlbum);
        setViewingFriend(true);
        setActiveTab("social");
        showToast("Lista do amigo carregada lado a lado!", "success");
      } else {
        showToast("Este colecionador ainda não iniciou o álbum.", "warn");
      }

    } catch (err) {
      console.error(err);
      showToast("Erro ao carregar link social.", "error");
    } finally {
      setLoadingFriend(false);
    }
  };

  // Helper selectors for layout statistics
  const globalProgressPercent = useMemo(() => {
    return Math.round((ownedStickers.length / TOTAL_STICKERS) * 100);
  }, [ownedStickers]);

  const globalMissingCount = useMemo(() => {
    return Math.max(0, TOTAL_STICKERS - ownedStickers.length);
  }, [ownedStickers]);

  // Social Swapping Cross Match Algorithm
  const matchTrades = useMemo(() => {
    if (!viewingFriend || !friendAlbum) return { canGive: [], canGet: [] };

    // My missing are: stickers not in my ownedStickers
    const myMissing = totalAlbumStickers.filter((id) => !ownedStickers.includes(id));
    // Friend's missing are: stickers not in friend's ownedStickers
    const friendMissing = totalAlbumStickers.filter((id) => !friendAlbum.ownedStickers.includes(id));

    // "What I can give them": My repeated stickers that are contained in friend's missing list
    const canGive = repeatedStickers.filter((id) => friendMissing.includes(id));

    // "What they can give me": Friend's repeated stickers that are contained in my missing list
    const canGet = friendAlbum.repeatedStickers.filter((id) => myMissing.includes(id));

    return { canGive, canGet };
  }, [viewingFriend, friendAlbum, ownedStickers, repeatedStickers]);

  // Best/worst stats analysis
  const statsInsights = useMemo(() => {
    let bestTeam = "Nenhum";
    let maxPct = -1;
    let bestGroup = "Nenhum";
    let maxGroupPct = -1;

    const groupStats: Record<string, { total: number; owned: number }> = {};

    albumSections.forEach((section) => {
      let ownedCount = 0;
      for (let i = 1; i <= section.stickersCount; i++) {
        if (ownedStickers.includes(`${section.prefix}_${i}`)) ownedCount++;
      }
      const pct = Math.round((ownedCount / section.stickersCount) * 100);

      if (pct > maxPct) {
        maxPct = pct;
        bestTeam = `${section.name} (${pct}%)`;
      }

      if (!groupStats[section.group]) {
        groupStats[section.group] = { total: 0, owned: 0 };
      }
      groupStats[section.group].total += section.stickersCount;
      groupStats[section.group].owned += ownedCount;
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
  }, [ownedStickers, globalProgressPercent]);

  // Export State
  const exportStateCode = () => {
    const backupObj = { owned: ownedStickers, repeated: repeatedStickers };
    const token = btoa(unescape(encodeURIComponent(JSON.stringify(backupObj))));
    navigator.clipboard.writeText(token);
    showToast("Código de backup copiado para a área de transferência!", "success");
  };

  // Import State
  const importStateCode = () => {
    const token = prompt("Insira o seu Código de Backup gerado anteriormente:");
    if (!token) return;
    try {
      const parsed = JSON.parse(decodeURIComponent(escape(atob(token))));
      if (parsed && Array.isArray(parsed.owned)) {
        setOwnedStickers(parsed.owned);
        setRepeatedStickers(parsed.repeated || []);
        localStorage.setItem("copa2026_owned", JSON.stringify(parsed.owned));
        localStorage.setItem("copa2026_repeated", JSON.stringify(parsed.repeated || []));
        
        if (user) {
          setDoc(doc(db, "albums", user.uid), {
            userId: user.uid,
            ownedStickers: parsed.owned,
            repeatedStickers: parsed.repeated || [],
            lastUpdated: new Date().toISOString(),
            progressPercent: Math.round((parsed.owned.length / TOTAL_STICKERS) * 100)
          });
        }
        showToast("Sincronização realizada com sucesso!", "success");
      } else {
        showToast("Formato de backup inválido.", "error");
      }
    } catch (e) {
      showToast("Código corrompido ou inválido.", "error");
    }
  };

  const resetToPhotos = () => {
    if (confirm("Deseja redefinir o álbum para as 413 figurinhas restantes detectadas inicialmente nas fotos?")) {
      const initialOwned = totalAlbumStickers.filter((id) => {
        const [prefix, numStr] = id.split("_");
        const num = parseInt(numStr, 10);
        const missingList = missingFromPhotos[prefix];
        if (!missingList) return true;
        return !missingList.includes(num);
      });
      setOwnedStickers(initialOwned);
      setRepeatedStickers([]);
      localStorage.setItem("copa2026_owned", JSON.stringify(initialOwned));
      localStorage.setItem("copa2026_repeated", JSON.stringify([]));

      if (user) {
        setDoc(doc(db, "albums", user.uid), {
          userId: user.uid,
          ownedStickers: initialOwned,
          repeatedStickers: [],
          lastUpdated: new Date().toISOString(),
          progressPercent: Math.round((initialOwned.length / TOTAL_STICKERS) * 100)
        });
      }
      showToast("Álbum restaurado para o estado das fotografias!", "info");
    }
  };

  const clearProgressTotal = () => {
    if (confirm("🚨 ATENÇÃO: Tem certeza que deseja zerar totalmente seu álbum? Todas as 988 figurinhas constarão como faltantes.")) {
      setOwnedStickers([]);
      setRepeatedStickers([]);
      localStorage.setItem("copa2026_owned", JSON.stringify([]));
      localStorage.setItem("copa2026_repeated", JSON.stringify([]));

      if (user) {
        setDoc(doc(db, "albums", user.uid), {
          userId: user.uid,
          ownedStickers: [],
          repeatedStickers: [],
          lastUpdated: new Date().toISOString(),
          progressPercent: 0
        });
      }
      showToast("Seu álbum foi completamente zerado.", "warn");
    }
  };

  // WhatsApp helper sharing text
  const copyWhatsAppList = () => {
    let textOutput = "📋 MINHAS FIGURINHAS FALTANTES (COPA 2026):\n\n";
    let totalMissing = 0;

    albumSections.forEach((section) => {
      const sectionMissing: string[] = [];
      for (let i = 1; i <= section.stickersCount; i++) {
        const id = `${section.prefix}_${i}`;
        if (!ownedStickers.includes(id)) {
          sectionMissing.push(`${section.prefix} ${i}`);
          totalMissing++;
        }
      }
      if (sectionMissing.length > 0) {
        textOutput += `👉 ${section.name}: ${sectionMissing.join(", ")}\n\n`;
      }
    });

    textOutput += `📊 Total restante: ${totalMissing} de ${TOTAL_STICKERS}`;
    navigator.clipboard.writeText(textOutput);
    showToast("Lista de faltas copiada para WhatsApp!", "success");
  };

  return (
    <div className="bg-[#0f0303] text-stone-200 min-h-screen flex flex-col font-sans selection:bg-[#6b0b0b] selection:text-white pb-12">
      
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

      {/* Header Panel */}
      <header className="bg-[#1a0505] text-stone-200 mt-6 mx-4 md:mx-8 p-6 border border-stone-800 rounded-2xl shadow-xl relative overflow-hidden">
        <div className="absolute inset-0 bg-opacity-5 bg-[radial-gradient(#ffffff_1px,transparent_1px)] [background-size:16px_16px] pointer-events-none" />
        <div className="max-w-7xl mx-auto flex flex-col lg:flex-row items-center justify-between gap-6 relative z-10">
          
          <div className="text-center lg:text-left flex items-center gap-4 justify-center lg:justify-start">
            <div className="w-12 h-12 bg-[#6b0b0b] rounded-xl flex items-center justify-center border border-[#d4af37]/30 shadow-md shrink-0">
              <span className="text-[#d4af37] font-extrabold text-2xl font-display">26</span>
            </div>
            <div className="text-left">
              <h1 className="text-2xl font-black tracking-tight text-stone-100 uppercase font-display flex items-center gap-2">
                🏆 Painel Copa 2026
              </h1>
              <p className="text-xs text-stone-500 font-medium uppercase tracking-widest mt-0.5">
                SaaS Colaborativo com Gemini Vision
              </p>
            </div>
          </div>

          {/* Nav & Social Auth Buttons */}
          <div className="flex flex-wrap items-center justify-center gap-4">
            <div className="flex bg-stone-900/80 p-1 rounded-xl border border-stone-800">
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
              <div className="flex items-center gap-3 bg-stone-900 border border-stone-800 p-1.5 pr-3 rounded-full">
                <img
                  src={profile.photoURL}
                  alt={profile.name}
                  className="w-8 h-8 rounded-full object-cover border border-[#d4af37]"
                />
                <div className="hidden sm:block text-left">
                  <p className="text-xs font-bold leading-none text-stone-200">{profile.name}</p>
                  <p className="text-[10px] text-stone-500 uppercase font-bold tracking-tighter mt-0.5">Colecionador</p>
                </div>
                <button
                  onClick={handleLogout}
                  className="p-1.5 hover:bg-white/10 rounded-full text-stone-400 hover:text-rose-400 smooth-transition"
                  title="Desconectar"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button
                onClick={handleLogin}
                className="bg-stone-900 hover:bg-stone-800 text-stone-100 border border-stone-800 hover:border-[#d4af37]/30 px-4 py-2 rounded-xl text-xs font-bold uppercase flex items-center gap-2 smooth-transition shadow-lg"
              >
                <LogIn className="w-4 h-4 text-[#d4af37]" />
                <span>Logar com Google</span>
              </button>
            )}
          </div>

        </div>
      </header>

      {/* Real-time Sticky Counter Dashboard */}
      <div className="bg-[#1a0505]/95 border-b border-stone-800/80 shadow-2xl py-4 px-4 md:px-8 sticky top-0 z-30 transition-all backdrop-blur-md">
        <div className="max-w-7xl mx-auto flex flex-col lg:flex-row gap-6 items-center justify-between">
          
          {/* Progress Circular representation */}
          <div className="w-full lg:w-auto flex items-center gap-4 justify-between lg:justify-start">
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

          {/* Social Friend Side-by-side indicator bar */}
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

          {/* Searching and quick filters */}
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

      <main className="max-w-7xl mx-auto px-4 w-full flex-1 mt-6 space-y-6">
        
        {/* VIEW 1: ALBUM TAB */}
        {activeTab === "album" && (
          <div className="space-y-6">
            
            {/* Country Group Selection Filters */}
            <div className="bg-[#1a0505] rounded-2xl border border-stone-800 p-4 shadow-2xl flex flex-col md:flex-row items-center justify-between gap-4">
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

            {/* Interactive Album Index & Flag Viewer */}
            <div className="bg-[#1a0505] rounded-2xl border border-stone-800 p-5 shadow-2xl space-y-4 text-left">
              <div className="flex justify-between items-center border-b border-stone-800/80 pb-3">
                <div className="flex items-center gap-2">
                  <span className="text-[#d4af37] text-lg">📖</span>
                  <h3 className="text-sm font-extrabold uppercase tracking-widest text-stone-200 font-display">
                    Índice Oficial & Mapa de Bandeiras do Álbum
                  </h3>
                </div>
                <button
                  onClick={() => setShowIndex(!showIndex)}
                  className="text-xs font-bold text-stone-400 hover:text-stone-100 bg-stone-900 border border-stone-800 px-3 py-1.5 rounded-lg smooth-transition"
                >
                  {showIndex ? "Recolher Índice ▵" : "Ver Índice Completo (Bandeiras) ▿"}
                </button>
              </div>

              {showIndex && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  className="space-y-4 overflow-hidden"
                >
                  <p className="text-xs text-stone-500">
                    Clique em qualquer seleção para navegar instantaneamente até a página correspondente no álbum.
                  </p>
                  
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-2.5">
                    {albumSections.map((sec) => {
                      const nameParts = sec.name.split(" ");
                      const flag = nameParts[0] || "🏳️";
                      const cleanName = nameParts.slice(1).join(" ") || sec.name;

                      let secOwned = 0;
                      for (let i = 1; i <= sec.stickersCount; i++) {
                        if (ownedStickers.includes(`${sec.prefix}_${i}`)) secOwned++;
                      }
                      const pct = Math.round((secOwned / sec.stickersCount) * 100);
                      const isComplete = pct === 100;

                      return (
                        <button
                          key={sec.id}
                          onClick={() => navigateToCountry(sec.id, sec.group)}
                          className={`flex flex-col justify-between p-2.5 rounded-xl text-left border transition-all hover:scale-[1.03] duration-300 ${
                            isComplete
                              ? "bg-emerald-950/20 border-emerald-500/30 hover:border-emerald-500/60"
                              : "bg-stone-900/40 border-stone-800/80 hover:border-[#d4af37]/30"
                          }`}
                        >
                          <div className="flex items-center gap-1.5 justify-between">
                            <span className="text-xl shrink-0" title={cleanName}>{flag}</span>
                            <span className="text-[9px] font-black text-stone-500 uppercase tracking-tight">{sec.prefix}</span>
                          </div>
                          <div className="mt-1.5">
                            <span className="text-[10px] font-bold text-stone-300 truncate block leading-tight">
                              {cleanName}
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
                </motion.div>
              )}
            </div>

            {/* Render Countries Panels */}
            <div className="space-y-6">
              {albumSections
                .filter((section) => activeGroupFilter === "all" || section.group === activeGroupFilter)
                .map((section) => {
                  const matchingStickers: number[] = [];

                  // Filter the stickers inside this country section
                  for (let i = 1; i <= section.stickersCount; i++) {
                     const id = `${section.prefix}_${i}`;
                     const isOwned = ownedStickers.includes(id);
                     const isRepeated = repeatedStickers.includes(id);

                     if (viewFilter === "missing" && isOwned) continue;
                     if (viewFilter === "owned" && !isOwned) continue;
                     if (viewFilter === "repeated" && !isRepeated) continue;

                     // Match query
                     const matchesSearch =
                      section.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                      section.prefix.toLowerCase().includes(searchQuery.toLowerCase()) ||
                      id.toLowerCase().includes(searchQuery.toLowerCase().replace(" ", "_"));

                     if (searchQuery && !matchesSearch) continue;

                     matchingStickers.push(i);
                  }

                  if (matchingStickers.length === 0) return null;

                  // Stats for this selection
                  let sectionOwned = 0;
                  let sectionRepeated = 0;
                  for (let i = 1; i <= section.stickersCount; i++) {
                    const id = `${section.prefix}_${i}`;
                    if (ownedStickers.includes(id)) sectionOwned++;
                    if (repeatedStickers.includes(id)) sectionRepeated++;
                  }
                  const missingCount = section.stickersCount - sectionOwned;
                  const pct = Math.round((sectionOwned / section.stickersCount) * 100);

                  return (
                    <motion.div
                      layout
                      initial={{ opacity: 0, scale: 0.98 }}
                      animate={{ opacity: 1, scale: 1 }}
                      key={section.id}
                      id={`country-${section.id}`}
                      className={`bg-[#1a0505] rounded-2xl p-5 shadow-2xl space-y-4 transition-all duration-500 border ${
                        highlightedCountry === section.id
                          ? "border-[#d4af37] ring-4 ring-[#d4af37]/25 scale-[1.01]"
                          : "border-stone-800"
                      }`}
                    >
                      {/* Section Title */}
                      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-stone-800/80 pb-3 gap-2">
                        <div className="text-left">
                          <h3 className="text-base font-black text-stone-100 uppercase tracking-wider flex items-center gap-2 font-display">
                            <span>{section.name}</span>
                            <span className="text-[10px] bg-stone-900 text-stone-400 border border-stone-800/60 font-bold px-2 py-0.5 rounded uppercase">
                              Grupo {section.group}
                            </span>
                          </h3>
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
                        {matchingStickers.map((num) => {
                          const stickerId = `${section.prefix}_${num}`;
                          const isOwned = ownedStickers.includes(stickerId);
                          const isRepeated = repeatedStickers.includes(stickerId);

                          // Check if social swap matches
                          const isPerfectGive = viewingFriend && matchTrades.canGive.includes(stickerId);
                          const isPerfectGet = viewingFriend && matchTrades.canGet.includes(stickerId);

                          return (
                            <div
                              key={stickerId}
                              className="relative group rounded-xl overflow-hidden flex flex-col justify-between"
                            >
                              <button
                                onClick={() => toggleStickerState(stickerId)}
                                className={`w-full py-3 px-1 rounded-xl text-xs md:text-sm font-black border flex flex-col items-center justify-center cursor-pointer select-none smooth-transition aspect-square relative ${
                                  isRepeated
                                    ? "bg-amber-950/60 border-[#d4af37] text-[#d4af37] shadow-lg shadow-amber-950/40"
                                    : isOwned
                                    ? section.special
                                      ? "holographic-shine border-[#d4af37] text-[#1a0505] shadow-md"
                                      : "bg-emerald-950/60 border-emerald-500/80 text-emerald-300 shadow-lg shadow-emerald-950/40"
                                    : "bg-stone-900/40 border-stone-800 border-dashed text-stone-500 hover:border-[#6b0b0b] hover:bg-stone-800/40"
                                } ${
                                  (isPerfectGive || isPerfectGet) ? "perfect-trade-shine ring-2 ring-[#d4af37]" : ""
                                }`}
                              >
                                {isPerfectGive && (
                                  <span className="absolute top-1 left-1 bg-amber-500 text-stone-950 text-[8px] px-1 rounded font-bold animate-pulse">
                                    P/ AMIGO
                                  </span>
                                )}
                                {isPerfectGet && (
                                  <span className="absolute top-1 left-1 bg-teal-500 text-stone-950 text-[8px] px-1 rounded font-bold animate-pulse">
                                    TEM P/ MIM
                                  </span>
                                )}

                                <span className={`block font-bold ${isOwned ? "scale-105" : ""}`}>
                                  {section.prefix} {num}
                                </span>

                                <span className="text-[10px] mt-1 font-extrabold uppercase tracking-wider opacity-80">
                                  {isRepeated ? "Repetida" : isOwned ? "Colada" : "Vazio"}
                                </span>
                              </button>

                              {/* Hover controls to easily clear or force missing */}
                              {isOwned && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    quickMarkMissing(stickerId);
                                  }}
                                  className="absolute right-1 bottom-1 p-1 bg-stone-800/90 hover:bg-stone-700 text-rose-400 border border-stone-700 rounded-full shadow opacity-0 group-hover:opacity-100 transition-opacity"
                                  title="Marcar como Vazio"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              )}
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
                Tire foto ou carregue a imagem de uma página física do seu álbum. Nossa inteligência artificial (Gemini 3.5 Vision) detectará quais figurinhas estão coladas e quais estão em branco.
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
              
              {/* Left Column Controls */}
              <div className="lg:col-span-5 space-y-6">
                
                {/* Select Country Page */}
                <div className="space-y-2 text-left">
                  <label className="block text-xs font-black uppercase tracking-wider text-stone-500">
                    Selecione o País da Página
                  </label>
                  <select
                    value={selectedPrefix}
                    onChange={(e) => setSelectedPrefix(e.target.value)}
                    className="w-full px-4 py-3 bg-stone-900 border border-stone-800 rounded-xl outline-none font-bold text-stone-200 focus:border-[#d4af37] transition"
                  >
                    {albumSections.map((sec) => (
                      <option key={sec.prefix} value={sec.prefix}>
                        {sec.name} ({sec.prefix})
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-stone-500">
                    A IA focalizará os espaços correspondentes aos números de 1 a 20 desta seleção.
                  </p>
                </div>

                {/* Upload Area */}
                <div
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                  className="border-2 border-dashed border-stone-800 rounded-2xl p-6 text-center bg-stone-900/30 hover:bg-stone-900 hover:border-[#d4af37]/40 smooth-transition cursor-pointer relative"
                >
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleFileChange}
                    className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
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

                {/* Scan action buttons */}
                <button
                  onClick={triggerVisionScan}
                  disabled={!uploadedFile || scanning}
                  className={`w-full py-4 rounded-xl font-black text-sm uppercase tracking-wider flex items-center justify-center gap-2 smooth-transition ${
                    !uploadedFile
                      ? "bg-stone-900 text-stone-600 border border-stone-800/80 cursor-not-allowed"
                      : scanning
                      ? "bg-amber-600 text-white cursor-wait animate-pulse"
                      : "bg-[#6b0b0b] hover:bg-[#8f1212] border border-[#d4af37]/30 text-white shadow-lg active:scale-95"
                  }`}
                >
                  <Sparkles className="w-4 h-4 text-[#d4af37]" />
                  <span>{scanning ? "Analisando com Gemini Vision..." : "Analisar Página com IA"}</span>
                </button>

              </div>

              {/* Right Column: Previews and Result display */}
              <div className="lg:col-span-7 flex flex-col justify-center bg-stone-900/10 rounded-2xl p-6 border border-stone-800 min-h-[300px]">
                
                {scanning && (
                  <div className="flex flex-col items-center justify-center space-y-4 py-12">
                    <div className="w-12 h-12 border-4 border-[#6b0b0b] border-t-transparent rounded-full animate-spin" />
                    <div className="text-center">
                      <p className="text-sm font-black text-stone-300 uppercase animate-pulse">Escaneando página física...</p>
                      <p className="text-xs text-stone-500 mt-1">A IA está detectando os espaços preenchidos e vazios.</p>
                    </div>
                  </div>
                )}

                {!scanning && !scanResult && previewUrl && (
                  <div className="space-y-4">
                    <p className="text-xs font-bold uppercase tracking-wider text-stone-500 text-left">Foto Carregada</p>
                    <div className="relative rounded-xl overflow-hidden shadow-inner max-h-[350px]">
                      <img src={previewUrl} alt="Preview" className="w-full h-full object-contain bg-stone-950 rounded-xl" />
                    </div>
                  </div>
                )}

                {!scanning && !scanResult && !previewUrl && (
                  <div className="flex flex-col items-center justify-center text-center space-y-3 py-12 text-stone-500">
                    <HelpCircle className="w-12 h-12 text-stone-600" />
                    <div>
                      <p className="font-bold text-sm text-stone-400">Nenhum resultado de análise ativo</p>
                      <p className="text-xs text-stone-500">Faça upload da página da seleção para obter o feedback estruturado.</p>
                    </div>
                  </div>
                )}

                {/* Scan complete Result list */}
                {scanResult && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="space-y-6 text-left"
                  >
                    <div className="bg-emerald-950/40 border border-emerald-500/30 rounded-xl p-4 flex items-center gap-3">
                      <CheckCircle className="w-5 h-5 text-emerald-400" />
                      <div>
                        <p className="text-xs font-extrabold uppercase tracking-wider text-emerald-300">Análise Concluída</p>
                        <p className="text-sm text-emerald-400/90">
                          Identificadas {scanResult.filled.length} figurinhas coladas e {scanResult.empty.length} faltantes para {scanResult.prefix}.
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      
                      {/* Detected Coladas */}
                      <div className="bg-stone-900 border border-stone-800 rounded-xl p-4">
                        <p className="text-xs font-extrabold text-emerald-400 uppercase tracking-widest flex items-center gap-1.5 border-b border-stone-800 pb-2">
                          <Check className="w-4 h-4" />
                          <span>Coladas ({scanResult.filled.length})</span>
                        </p>
                        <div className="flex flex-wrap gap-1.5 mt-3">
                          {scanResult.filled.map((num) => (
                            <span key={num} className="bg-emerald-950/80 text-emerald-400 border border-emerald-500/20 text-xs font-bold px-2 py-1 rounded-lg">
                              {scanResult.prefix} {num}
                            </span>
                          ))}
                        </div>
                      </div>

                      {/* Detected Faltantes */}
                      <div className="bg-stone-900 border border-stone-800 rounded-xl p-4">
                        <p className="text-xs font-extrabold text-rose-400 uppercase tracking-widest flex items-center gap-1.5 border-b border-stone-800 pb-2">
                          <AlertCircle className="w-4 h-4" />
                          <span>Faltando ({scanResult.empty.length})</span>
                        </p>
                        <div className="flex flex-wrap gap-1.5 mt-3">
                          {scanResult.empty.map((num) => (
                            <span key={num} className="bg-rose-950/80 text-rose-300 border border-rose-500/20 text-xs font-bold px-2 py-1 rounded-lg">
                              {scanResult.prefix} {num}
                            </span>
                          ))}
                        </div>
                      </div>

                    </div>

                    <div className="flex gap-3">
                      <button
                        onClick={applyScanResult}
                        className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white border border-emerald-500/30 py-3 rounded-xl text-xs uppercase font-extrabold tracking-widest smooth-transition shadow"
                      >
                        Confirmar e Sincronizar
                      </button>
                      <button
                        onClick={() => setScanResult(null)}
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
                <p className="text-xs text-stone-500 mt-4">A seleção na qual você reuniu mais figurinhas até agora.</p>
              </div>

              <div className="bg-[#1a0505] border border-stone-800 rounded-2xl p-6 shadow-2xl flex flex-col justify-between">
                <div>
                  <h3 className="text-stone-500 font-extrabold uppercase text-[10px] tracking-wider">Grupo Mais Próximo</h3>
                  <p className="text-2xl font-black text-[#d4af37] mt-2 font-display">{statsInsights.bestGroup}</p>
                </div>
                <p className="text-xs text-stone-500 mt-4">O grupo mais próximo de completar as figurinhas.</p>
              </div>

              <div className="bg-[#1a0505] border border-stone-800 rounded-2xl p-6 shadow-2xl flex flex-col justify-between">
                <div>
                  <h3 className="text-stone-500 font-extrabold uppercase text-[10px] tracking-wider">Status do Colecionador</h3>
                  <p className="text-2xl font-black text-rose-400 mt-2 font-display">{statsInsights.rank}</p>
                </div>
                <p className="text-xs text-stone-500 mt-4">Sua categoria atualizada dinamicamente com base no seu preenchimento.</p>
              </div>

            </div>

            {/* Progresso Detalhado por Países */}
            <div className="bg-[#1a0505] border border-stone-800 rounded-2xl p-6 shadow-2xl">
              <h3 className="text-lg font-black text-stone-100 uppercase tracking-wide mb-6 border-b border-stone-800 pb-3 flex items-center gap-2 font-display">
                <TrendingUp className="w-5 h-5 text-[#d4af37]" />
                <span>Estatísticas por Seleção</span>
              </h3>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {albumSections.map((sec) => {
                  let countOwned = 0;
                  for (let i = 1; i <= sec.stickersCount; i++) {
                    if (ownedStickers.includes(`${sec.prefix}_${i}`)) countOwned++;
                  }
                  const pct = Math.round((countOwned / sec.stickersCount) * 100);

                  return (
                    <div key={sec.id} className="bg-stone-900 border border-stone-800/80 rounded-xl p-4 flex flex-col justify-between text-left">
                      <div className="flex justify-between items-start mb-2">
                        <span className="font-bold text-sm text-stone-300">{sec.name}</span>
                        <span className="text-xs font-black text-[#d4af37]">{pct}%</span>
                      </div>
                      <div className="w-full bg-stone-950 h-2 rounded-full overflow-hidden border border-stone-800/55">
                        <div className="bg-[#6b0b0b] h-full" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-[10px] text-stone-500 font-bold block mt-2 text-right">
                        {countOwned} de {sec.stickersCount} coladas
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Administracao Tecnica (Backups e resets) */}
            <div className="bg-[#1a0505] border border-stone-800 text-stone-200 rounded-2xl p-6 shadow-2xl space-y-4 text-left">
              <h3 className="text-lg font-black text-amber-400 uppercase tracking-wide font-display">⚙️ Gerenciamento Técnico do Álbum</h3>
              <p className="text-xs text-stone-500">
                Aqui você pode gerenciar seu backup e restaurar estados locais para sincronizar dados offline e online de forma segura.
              </p>
              <div className="flex flex-wrap gap-3 pt-2">
                <button
                  onClick={exportStateCode}
                  className="bg-stone-900 hover:bg-stone-800 border border-stone-800 text-stone-300 text-xs font-bold uppercase px-4 py-3 rounded-xl transition"
                >
                  📥 Exportar Backup
                </button>
                <button
                  onClick={importStateCode}
                  className="bg-stone-900 hover:bg-stone-800 border border-stone-800 text-stone-300 text-xs font-bold uppercase px-4 py-3 rounded-xl transition"
                >
                  📤 Importar Backup
                </button>
                <button
                  onClick={resetToPhotos}
                  className="bg-amber-600/90 hover:bg-amber-700 text-white text-xs font-bold uppercase px-4 py-3 rounded-xl transition"
                >
                  📸 Restaurar Fotos Originais
                </button>
                <button
                  onClick={clearProgressTotal}
                  className="bg-rose-700/90 hover:bg-rose-800 text-white text-xs font-bold uppercase px-4 py-3 rounded-xl transition"
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
                Gere seu código curto de compartilhamento, envie para seus amigos e cruze as listas em tempo real para descobrir "trocas ideais" com brilho holográfico dourado automático!
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
                    <p className="text-[11px] text-stone-500">
                      Envie o link para que seus amigos vejam o que vocês têm para trocar em tempo real lado a lado.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-xs text-stone-500">Você ainda não tem um link de compartilhamento ativo.</p>
                    <button
                      onClick={generateMyShareLink}
                      disabled={generatingShare}
                      className="bg-[#6b0b0b] hover:bg-[#8f1212] border border-[#d4af37]/20 text-white px-5 py-3 rounded-xl text-xs font-bold uppercase tracking-wider smooth-transition shadow flex items-center gap-1.5"
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
                  <p className="text-xs text-stone-500">Cole o código curto ou link de trocas do seu amigo:</p>
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
                      className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 border border-emerald-500/20 rounded-xl text-xs font-bold uppercase smooth-transition shrink-0"
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
                      <p className="text-xs text-stone-500 mt-4 italic">Nenhuma figurinha repetida minha serve para o álbum dele de momento.</p>
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
                      <p className="text-xs text-stone-500 mt-4 italic">Ele não possui nenhuma repetida que esteja faltando no meu álbum.</p>
                    )}
                  </div>

                </div>

                {matchTrades.canGive.length > 0 && matchTrades.canGet.length > 0 ? (
                  <div className="bg-emerald-950/20 border border-emerald-500/25 p-4 rounded-xl flex items-center gap-3">
                    <Sparkles className="w-6 h-6 text-[#d4af37]" />
                    <p className="text-xs font-bold text-emerald-300">
                      <strong>Troca Bilateral Perfeita Disponível!</strong> Vocês têm figurinhas repetidas compatíveis. Clique no botão de WhatsApp do cabeçalho ou combine o encontro para realizar a troca física!
                    </p>
                  </div>
                ) : (
                  <p className="text-[11px] text-stone-500 italic text-center">
                    Cruze dados com outros amigos e encontre a compatibilidade perfeita.
                  </p>
                )}

              </motion.div>
            )}

          </div>
        )}

      </main>

    </div>
  );
}
