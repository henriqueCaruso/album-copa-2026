import React, { useState, useRef } from "react";
import { X, Upload, Download, AlertCircle, RefreshCw } from "lucide-react";
import { generateBackupObject } from "../services/progressBackup";

interface ExportModalProps {
  onClose: () => void;
  uid?: string;
  counts: Record<string, number>;
}

export const ExportModal: React.FC<ExportModalProps> = ({ onClose, uid, counts }) => {
  const handleExport = () => {
    const backupObj = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      uid: uid ? uid.substring(0, 5) + "***" : "guest",
      counts,
      metrics: {
        totalPhysical: Object.values(counts).reduce((a: number, b: number) => a + b, 0),
        unique: Object.keys(counts).filter(k => counts[k] >= 1).length
      }
    };
    const blob = new Blob([JSON.stringify(backupObj, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `album-backup-${backupObj.uid}-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <div className="bg-[#1a0505] border border-stone-800 rounded-2xl p-6 w-full max-w-sm shadow-2xl relative text-center">
        <button onClick={onClose} className="absolute top-4 right-4 p-2 text-stone-400 hover:text-white bg-stone-900 rounded-full">
          <X className="w-5 h-5" />
        </button>
        <div className="w-12 h-12 bg-stone-900 rounded-full flex items-center justify-center mx-auto mb-4 border border-stone-700">
          <Download className="w-6 h-6 text-[#d4af37]" />
        </div>
        <h2 className="text-xl font-black text-stone-100 uppercase tracking-tight mb-2">Exportar Álbum</h2>
        <p className="text-sm text-stone-400 mb-6">Salve um arquivo JSON com todas as suas quantidades. Útil para backup seguro.</p>
        <button onClick={handleExport} className="w-full bg-[#d4af37] text-black font-bold py-3 rounded-xl hover:bg-yellow-500">
          Baixar Arquivo JSON
        </button>
      </div>
    </div>
  );
};

interface ImportModalProps {
  onClose: () => void;
  onImport: (parsedCounts: Record<string, number>, mode: "merge" | "replace") => Promise<void>;
}

export const ImportModal: React.FC<ImportModalProps> = ({ onClose, onImport }) => {
  const [fileData, setFileData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"merge" | "replace">("merge");
  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const parsed = JSON.parse(evt.target?.result as string);
        if (!parsed || typeof parsed !== 'object' || !parsed.counts) {
          setError("Formato de arquivo inválido. A propriedade 'counts' não foi encontrada.");
          return;
        }
        setFileData(parsed);
        setError(null);
      } catch (err) {
        setError("Não foi possível ler o arquivo JSON.");
      }
    };
    reader.readAsText(file);
  };

  const confirmImport = async () => {
    if (!fileData || !fileData.counts) return;
    
    if (mode === "replace") {
      const confirm2 = window.confirm("ATENÇÃO: Você escolheu SUBSTITUIR. O seu álbum atual será completamente apagado e substituído por este backup. Tem certeza?");
      if (!confirm2) return;
    }

    setIsProcessing(true);
    try {
      await onImport(fileData.counts, mode);
      onClose();
    } catch (e) {
      setError("Erro ao salvar a importação.");
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <div className="bg-[#1a0505] border border-stone-800 rounded-2xl p-6 w-full max-w-lg shadow-2xl relative">
        <button onClick={onClose} className="absolute top-4 right-4 p-2 text-stone-400 hover:text-white bg-stone-900 rounded-full">
          <X className="w-5 h-5" />
        </button>
        <h2 className="text-xl font-black text-stone-100 uppercase tracking-tight mb-2 flex items-center gap-2">
          <Upload className="w-5 h-5 text-amber-400" /> Importar Backup
        </h2>

        {!fileData ? (
          <div className="mt-6 text-center">
             <input type="file" accept=".json" className="hidden" ref={fileInputRef} onChange={handleFileChange} />
             <button onClick={() => fileInputRef.current?.click()} className="w-full bg-stone-900 border border-stone-700 py-8 rounded-xl text-stone-400 hover:text-stone-200 hover:border-[#d4af37] transition">
                Clique para selecionar o arquivo .json
             </button>
             {error && <p className="text-rose-400 text-sm mt-3">{error}</p>}
          </div>
        ) : (
          <div className="mt-4 space-y-4">
             <div className="bg-stone-900 p-4 rounded-lg border border-stone-800">
               <h3 className="font-bold text-stone-200 mb-2">Arquivo lido com sucesso</h3>
               <p className="text-sm text-stone-400">Total de códigos no arquivo: {Object.keys(fileData.counts).length}</p>
             </div>
             
             <div>
               <h4 className="font-bold text-stone-300 text-sm mb-2">Escolha o modo de importação:</h4>
               <div className="grid grid-cols-2 gap-3">
                 <button 
                   onClick={() => setMode("merge")}
                   className={`p-3 border rounded-xl text-left ${mode === "merge" ? "bg-[#6b0b0b] border-[#d4af37]/50 text-white" : "bg-stone-900 border-stone-800 text-stone-400"}`}
                 >
                   <strong className="block mb-1">Mesclar</strong>
                   <span className="text-xs opacity-80">Mantém o maior valor de cada figurinha. Mais seguro.</span>
                 </button>
                 <button 
                   onClick={() => setMode("replace")}
                   className={`p-3 border rounded-xl text-left ${mode === "replace" ? "bg-rose-900/50 border-rose-500 text-white" : "bg-stone-900 border-stone-800 text-stone-400"}`}
                 >
                   <strong className="block mb-1">Substituir</strong>
                   <span className="text-xs opacity-80">Apaga seu álbum atual e usa apenas os dados do arquivo.</span>
                 </button>
               </div>
             </div>

             <div className="flex gap-3 mt-6">
               <button onClick={() => setFileData(null)} disabled={isProcessing} className="flex-1 py-3 px-4 rounded-xl font-bold border border-stone-700 text-stone-400 hover:bg-stone-800 disabled:opacity-50">
                 Trocar Arquivo
               </button>
               <button onClick={confirmImport} disabled={isProcessing} className="flex-1 py-3 px-4 rounded-xl font-bold bg-[#d4af37] text-black hover:bg-yellow-500 flex items-center justify-center disabled:opacity-50">
                 {isProcessing ? <RefreshCw className="w-5 h-5 animate-spin" /> : "Confirmar"}
               </button>
             </div>
             {error && <p className="text-rose-400 text-sm mt-3">{error}</p>}
          </div>
        )}
      </div>
    </div>
  );
};
