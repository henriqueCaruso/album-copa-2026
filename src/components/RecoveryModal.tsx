import React, { useState } from "react";
import { motion } from "motion/react";
import { Download, Upload, AlertCircle, Database, CheckCircle, RefreshCw, X } from "lucide-react";
import { auth, db } from "../firebase";
import { doc, getDoc, collection, serverTimestamp, runTransaction } from "firebase/firestore";
import { readLocalAlbumV2, parseLegacyOwned, parseLegacyRepeated } from "../services/progressStorage";
import { fetchFirestoreProgress } from "../services/firestoreProgress";
import { mergeProgressSnapshots, buildRecoveryPreview, RecoveryPreview } from "../services/progressMigration";
import { exportBackup, generateBackupObject } from "../services/progressBackup";

interface RecoveryModalProps {
  onClose: () => void;
  uid: string;
}

export const RecoveryModal: React.FC<RecoveryModalProps> = ({ onClose, uid }) => {
  const [loading, setLoading] = useState(false);
  const [analyzed, setAnalyzed] = useState(false);
  const [sources, setSources] = useState<{
    firestore: Record<string, number>;
    localV2: Record<string, number>;
    legacyOwned: Record<string, number>;
    legacyRepeated: Record<string, number>;
  } | null>(null);
  
  const [preview, setPreview] = useState<RecoveryPreview | null>(null);
  const [migrating, setMigrating] = useState(false);
  const [success, setSuccess] = useState(false);
  const [migrationId, setMigrationId] = useState("");
  const [manualBackupDone, setManualBackupDone] = useState(false);
  const [mismatches, setMismatches] = useState<string[]>([]);
  const [showInvalidIds, setShowInvalidIds] = useState(false);

  const analyzeSources = async () => {
    setLoading(true);
    try {
      const fs = await fetchFirestoreProgress(uid);
      const locV2 = readLocalAlbumV2();
      const legOwn = parseLegacyOwned();
      const legRep = parseLegacyRepeated();

      setSources({
        firestore: fs,
        localV2: locV2,
        legacyOwned: legOwn,
        legacyRepeated: legRep
      });

      const merged = mergeProgressSnapshots(fs, locV2, legOwn, legRep);
      const prev = buildRecoveryPreview(fs, merged);
      setPreview(prev);
      setAnalyzed(true);
    } catch (error) {
      console.error(error);
      alert("Erro ao analisar as fontes.");
    } finally {
      setLoading(false);
    }
  };

  const handleExportBackup = () => {
    if (!sources || !preview) return;
    
    // Create comprehensive backup
    const backupObj = {
      ...generateBackupObject(uid, sources.firestore, sources.localV2),
      legacyOwned: sources.legacyOwned,
      legacyRepeated: sources.legacyRepeated,
      mergedCounts: preview.counts,
      invalidIds: preview.invalidIds,
      migrationPreview: preview,
      schemaVersion: 1
    };
    
    exportBackup(backupObj, `album-backup-${uid.substring(0, 5)}.json`);
    setManualBackupDone(true);
  };

  const handleRecover = async () => {
    if (!auth.currentUser || auth.currentUser.uid !== uid) {
      alert("UID incompatível! Faça login novamente.");
      return;
    }
    if (!preview || Object.keys(preview.counts).length === 0) {
      alert("Nada a recuperar.");
      return;
    }
    if (!manualBackupDone) {
      alert("Por favor, exporte o backup manualmente antes de continuar.");
      return;
    }

    setMigrating(true);
    setMismatches([]);
    try {
      const mId = migrationId || `mig_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      setMigrationId(mId);

      const targetStickers = Object.entries(preview.counts).filter(([id, count]) => (count as number) > 0);
      
      for (let i = 0; i < targetStickers.length; i += 400) {
        const chunk = targetStickers.slice(i, i + 400);
        
        await runTransaction(db, async (transaction) => {
          const docRefs = chunk.map(([id]) => doc(db, "users", uid, "stickers", id));
          const reads = await Promise.all(docRefs.map(ref => transaction.get(ref)));
          
          reads.forEach((docSnap, index) => {
            const stickerId = chunk[index][0];
            const proposedCount = chunk[index][1] as number;
            let finalCount = proposedCount;
            
            if (docSnap.exists()) {
              const remoteCount = docSnap.data().ownedCount || 0;
              finalCount = Math.max(remoteCount, proposedCount);
            }
            
            transaction.set(docRefs[index], {
              stickerId,
              ownedCount: finalCount,
              isOwned: finalCount >= 1,
              isDuplicate: finalCount >= 2,
              source: "recovery",
              updatedAt: serverTimestamp()
            }, { merge: true });
          });
        });
      }

      // Verification Step
      const postRecoveryFs = await fetchFirestoreProgress(uid);
      const errors: string[] = [];
      targetStickers.forEach(([id, expectedCountVal]) => {
        const expectedCount = expectedCountVal as number;
        const actualCount = postRecoveryFs[id] || 0;
        if (actualCount < expectedCount) {
          errors.push(`${id} (Esperado: ${expectedCount}, Atual: ${actualCount})`);
        }
      });

      if (errors.length > 0) {
        setMismatches(errors);
        alert(`Recuperação parcial. ${errors.length} figurinhas não atingiram o valor esperado. Tente novamente.`);
        setMigrating(false);
        return; // Halt success
      }

      const logRef = doc(collection(db, "users", uid, "activity"));
      await runTransaction(db, async (tx) => {
        tx.set(logRef, {
          userId: uid,
          type: "progress_recovery",
          migrationId: mId,
          schemaVersion: 1,
          verified: true,
          verifiedAt: serverTimestamp(),
          mismatches: 0,
          sourceSummary: {
            firestore: Object.keys(sources!.firestore).length,
            localV2: Object.keys(sources!.localV2).length,
            legacyOwned: Object.keys(sources!.legacyOwned).length,
            legacyRepeated: Object.keys(sources!.legacyRepeated).length
          },
          before: {
            uniqueOwned: Object.keys(sources!.firestore).filter(k => sources!.firestore[k] >= 1).length,
            repeated: Object.keys(sources!.firestore).filter(k => sources!.firestore[k] >= 2).length,
            extraCopies: Object.values(sources!.firestore).reduce((acc, c) => (acc as number) + Math.max(0, (c as number) - 1), 0)
          },
          after: {
            uniqueOwned: preview.totalUnique,
            repeated: preview.totalRepeated,
            extraCopies: preview.totalExtra
          },
          created: preview.docsCreated,
          updated: preview.docsUpdated,
          unchanged: preview.docsUnchanged,
          invalidIds: preview.invalidIds.length,
          timestamp: serverTimestamp()
        });

        const userRef = doc(db, "users", uid);
        tx.set(userRef, {
          progressRecovery: {
            schemaVersion: 1,
            migrationId: mId,
            completed: true,
            completedAt: serverTimestamp()
          }
        }, { merge: true });
      });

      setSuccess(true);
      alert("Recuperação verificada e concluída com sucesso!");
    } catch (error) {
      console.error(error);
      alert("Erro durante a gravação da recuperação.");
    } finally {
      setMigrating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <div className="bg-[#1a0505] border border-stone-800 rounded-2xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl relative">
        <button onClick={onClose} className="absolute top-4 right-4 p-2 text-stone-400 hover:text-white bg-stone-900 rounded-full">
          <X className="w-5 h-5" />
        </button>

        <h2 className="text-xl font-black text-stone-100 uppercase tracking-tight mb-2 flex items-center gap-2">
          <Database className="w-5 h-5 text-amber-400" />
          Diagnóstico e Recuperação
        </h2>
        <p className="text-sm text-stone-400 mb-6">Analise conflitos entre armazenamento local e nuvem.</p>

        {!analyzed ? (
          <div className="space-y-4">
            <button 
              onClick={analyzeSources} 
              disabled={loading}
              className="w-full bg-stone-900 hover:bg-stone-800 border border-stone-700 p-4 rounded-xl text-left transition flex items-center justify-between"
            >
              <div>
                <h3 className="text-stone-200 font-bold">1. Analisar Fontes de Dados</h3>
                <p className="text-xs text-stone-500">Compara Firestore, LocalStorage V2 e LocalStorage Legado.</p>
              </div>
              {loading ? <RefreshCw className="w-5 h-5 animate-spin text-stone-400" /> : <Database className="w-5 h-5 text-stone-400" />}
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-stone-900 p-3 rounded-lg border border-stone-800">
                <div className="text-xs text-stone-500 uppercase font-bold">Firestore</div>
                <div className="text-xl text-emerald-400 font-bold">{Object.keys(sources!.firestore).length}</div>
              </div>
              <div className="bg-stone-900 p-3 rounded-lg border border-stone-800">
                <div className="text-xs text-stone-500 uppercase font-bold">Local V2</div>
                <div className="text-xl text-amber-400 font-bold">{Object.keys(sources!.localV2).length}</div>
              </div>
              <div className="bg-stone-900 p-3 rounded-lg border border-stone-800">
                <div className="text-xs text-stone-500 uppercase font-bold">Legado (Owned)</div>
                <div className="text-xl text-stone-300 font-bold">{Object.keys(sources!.legacyOwned).length}</div>
              </div>
              <div className="bg-stone-900 p-3 rounded-lg border border-stone-800">
                <div className="text-xs text-stone-500 uppercase font-bold">Legado (Repetidas)</div>
                <div className="text-xl text-stone-300 font-bold">{Object.keys(sources!.legacyRepeated).length}</div>
              </div>
            </div>

            <div className="bg-[#6b0b0b]/20 border border-[#6b0b0b] rounded-lg p-4">
              <h3 className="text-stone-200 font-bold mb-2 flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-emerald-400" /> Preview da Mesclagem Segura
              </h3>
              <p className="text-sm text-stone-400 mb-3">
                Os dados serão mesclados mantendo a <strong>maior</strong> contagem encontrada em qualquer fonte.
              </p>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="flex justify-between bg-black/30 p-2 rounded">
                  <span className="text-stone-500">Únicas a Resultar:</span>
                  <span className="text-white font-bold">{preview!.totalUnique}</span>
                </div>
                <div className="flex justify-between bg-black/30 p-2 rounded">
                  <span className="text-stone-500">Docs a Criar:</span>
                  <span className="text-emerald-400 font-bold">{preview!.docsCreated}</span>
                </div>
                <div className="flex justify-between bg-black/30 p-2 rounded">
                  <span className="text-stone-500">Docs a Atualizar:</span>
                  <span className="text-amber-400 font-bold">{preview!.docsUpdated}</span>
                </div>
                <div className="flex justify-between bg-black/30 p-2 rounded">
                  <span className="text-stone-500">Inalterados:</span>
                  <span className="text-stone-400 font-bold">{preview!.docsUnchanged}</span>
                </div>
                <div className="flex justify-between bg-black/30 p-2 rounded col-span-2">
                  <span className="text-stone-500 flex items-center gap-1 cursor-pointer hover:text-stone-300" onClick={() => setShowInvalidIds(!showInvalidIds)}>
                    IDs Inválidos Ignorados: <AlertCircle className="w-3 h-3" />
                  </span>
                  <span className="text-rose-400 font-bold">{preview!.invalidIds.length}</span>
                </div>
              </div>
              
              {showInvalidIds && preview!.invalidIds.length > 0 && (
                <div className="mt-2 bg-black/50 p-2 rounded max-h-32 overflow-y-auto text-xs text-stone-400">
                  <ul className="space-y-1">
                    {preview!.invalidIds.map((inv, idx) => (
                      <li key={idx} className="flex justify-between border-b border-stone-800 pb-1">
                        <span className="font-mono text-rose-300">{inv.id}</span>
                        <span>Origem: {inv.source} ({String(inv.rawCount)})</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {mismatches.length > 0 && (
              <div className="bg-rose-950/40 border border-rose-900 rounded-lg p-4 mt-2 text-rose-300 text-sm">
                <h4 className="font-bold flex items-center gap-1 mb-2"><AlertCircle className="w-4 h-4" /> Divergências Encontradas Pós-Gravação</h4>
                <ul className="list-disc pl-4 space-y-1 h-32 overflow-y-auto">
                  {mismatches.map((m, idx) => <li key={idx}>{m}</li>)}
                </ul>
              </div>
            )}

            <div className="flex gap-3 mt-6 flex-col md:flex-row">
              <button 
                onClick={handleExportBackup}
                className="flex-1 bg-stone-800 hover:bg-stone-700 text-stone-200 font-bold py-3 px-4 rounded-xl border border-stone-700 transition flex items-center justify-center gap-2"
              >
                <Download className="w-4 h-4" /> {manualBackupDone ? "Backup Salvo" : "Exportar Backup JSON"}
              </button>

              <button 
                onClick={handleRecover}
                disabled={migrating || success || !manualBackupDone}
                className={`flex-1 font-bold py-3 px-4 rounded-xl border transition flex items-center justify-center gap-2 ${
                  success ? "bg-emerald-600 border-emerald-500 text-white" : manualBackupDone ? "bg-[#d4af37] hover:bg-yellow-500 text-black border-[#d4af37]" : "bg-stone-800 text-stone-500 border-stone-700"
                } disabled:opacity-50`}
                title={!manualBackupDone ? "Exporte o backup primeiro" : ""}
              >
                {migrating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {success ? "Concluído!" : "Executar Recuperação"}
              </button>
            </div>
            
            {success && (
              <div className="text-center text-sm text-stone-400 mt-2">
                Migration ID: <span className="font-mono">{migrationId}</span>. <br/> Recarregue a página para atualizar o álbum.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
