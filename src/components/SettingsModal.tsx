import React from "react";
import { X, Database, PlusCircle, Download, Upload, Share2, Trash2, LogOut } from "lucide-react";

interface SettingsModalProps {
  onClose: () => void;
  onOpenRecovery: () => void;
  onOpenQuickAdd: () => void;
  onOpenExport: () => void;
  onOpenImport: () => void;
  onClearLocal: () => void;
  onLogout: () => void;
  isAuthenticated: boolean;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  onClose,
  onOpenRecovery,
  onOpenQuickAdd,
  onOpenExport,
  onOpenImport,
  onClearLocal,
  onLogout,
  isAuthenticated
}) => {
  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <div className="bg-[#1a0505] border border-stone-800 rounded-2xl p-6 w-full max-w-sm shadow-2xl relative">
        <button onClick={onClose} className="absolute top-4 right-4 p-2 text-stone-400 hover:text-white bg-stone-900 rounded-full">
          <X className="w-5 h-5" />
        </button>
        <h2 className="text-xl font-black text-stone-100 uppercase tracking-tight mb-6">Configurações</h2>
        
        <div className="space-y-2">
          {isAuthenticated && (
            <button onClick={() => { onClose(); onOpenRecovery(); }} className="w-full text-left p-4 bg-stone-900 hover:bg-stone-800 rounded-xl border border-stone-800 flex items-center gap-3 text-stone-200 font-bold">
              <Database className="w-5 h-5 text-amber-400" /> Diagnóstico e recuperação
            </button>
          )}
          
          <button onClick={() => { onClose(); onOpenQuickAdd(); }} className="w-full text-left p-4 bg-stone-900 hover:bg-stone-800 rounded-xl border border-stone-800 flex items-center gap-3 text-stone-200 font-bold">
            <PlusCircle className="w-5 h-5 text-emerald-400" /> Adicionar repetidas
          </button>
          
          <button onClick={() => { onClose(); onOpenExport(); }} className="w-full text-left p-4 bg-stone-900 hover:bg-stone-800 rounded-xl border border-stone-800 flex items-center gap-3 text-stone-200 font-bold">
            <Download className="w-5 h-5 text-stone-400" /> Exportar álbum
          </button>
          
          <button onClick={() => { onClose(); onOpenImport(); }} className="w-full text-left p-4 bg-stone-900 hover:bg-stone-800 rounded-xl border border-stone-800 flex items-center gap-3 text-stone-200 font-bold">
            <Upload className="w-5 h-5 text-stone-400" /> Importar backup
          </button>
          
          <button onClick={() => { onClose(); document.getElementById('tab-social')?.click(); }} className="w-full text-left p-4 bg-stone-900 hover:bg-stone-800 rounded-xl border border-stone-800 flex items-center gap-3 text-stone-200 font-bold">
            <Share2 className="w-5 h-5 text-blue-400" /> Gerenciar compartilhamento
          </button>
          
          <button onClick={() => { onClose(); onClearLocal(); }} className="w-full text-left p-4 bg-stone-900 hover:bg-stone-800 rounded-xl border border-stone-800 flex items-center gap-3 text-stone-200 font-bold">
            <Trash2 className="w-5 h-5 text-rose-400" /> Apagar progresso deste navegador
          </button>

          {isAuthenticated && (
            <button onClick={() => { onClose(); onLogout(); }} className="w-full text-left p-4 bg-stone-900 hover:bg-rose-950/40 rounded-xl border border-stone-800 flex items-center gap-3 text-rose-400 font-bold mt-4">
              <LogOut className="w-5 h-5" /> Sair
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
