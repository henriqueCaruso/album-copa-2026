import React, { useState } from "react";
import { X, CheckCircle, AlertCircle, Save } from "lucide-react";
import { parseQuickAddInput, ParsedSticker } from "../utils/parserUtils";
import { stickersMap } from "../data";

interface QuickAddModalProps {
  onClose: () => void;
  onConfirm: (updates: ParsedSticker[]) => Promise<void>;
  currentCounts: Record<string, number>;
}

export const QuickAddModal: React.FC<QuickAddModalProps> = ({ onClose, onConfirm, currentCounts }) => {
  const [input, setInput] = useState("");
  const [parsedValid, setParsedValid] = useState<ParsedSticker[]>([]);
  const [parsedInvalid, setParsedInvalid] = useState<string[]>([]);
  const [isAnalyzed, setIsAnalyzed] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const handleAnalyze = () => {
    const { valid, invalid } = parseQuickAddInput(input);
    setParsedValid(valid);
    setParsedInvalid(invalid);
    setIsAnalyzed(true);
  };

  const handleConfirm = async () => {
    if (parsedValid.length === 0) return;
    setIsSaving(true);
    try {
      await onConfirm(parsedValid);
      onClose();
    } catch (e) {
      console.error(e);
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <div className="bg-[#1a0505] border border-stone-800 rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl relative">
        <button onClick={onClose} className="absolute top-4 right-4 p-2 text-stone-400 hover:text-white bg-stone-900 rounded-full transition">
          <X className="w-5 h-5" />
        </button>

        <h2 className="text-xl font-black text-stone-100 uppercase tracking-tight mb-2 flex items-center gap-2">
          Adicionar Repetidas
        </h2>
        <p className="text-sm text-stone-400 mb-4">
          Cole textos, listas ou mensagens contendo os códigos das suas figurinhas repetidas.
        </p>

        {!isAnalyzed ? (
          <div className="space-y-4">
            <textarea
              className="w-full h-32 bg-stone-900 border border-stone-700 text-stone-200 rounded-lg p-3 text-sm focus:outline-none focus:border-[#d4af37]"
              placeholder={"Exemplos aceitos:\nBRA 1\nBRA_2 x2\nARG 7, ARG 8\nBRA 1-5"}
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
            
            <div className="bg-stone-900 p-3 rounded-lg text-xs text-stone-400 border border-stone-800">
              <strong className="text-stone-300 block mb-1">Dicas de formato:</strong>
              <ul className="list-disc pl-4 space-y-1">
                <li>Separadores: espaço, vírgula, ponto e vírgula ou quebra de linha.</li>
                <li>Multiplicadores: <strong>x2</strong> ou <strong>2x</strong>.</li>
                <li>Intervalos: <strong>BRA 1-5</strong>.</li>
              </ul>
            </div>

            <div className="flex gap-3">
              <button onClick={onClose} className="flex-1 py-3 px-4 rounded-xl font-bold border border-stone-700 text-stone-400 hover:bg-stone-800">
                Cancelar
              </button>
              <button 
                onClick={handleAnalyze} 
                disabled={input.trim() === ""}
                className="flex-1 py-3 px-4 rounded-xl font-bold bg-[#6b0b0b] text-white hover:bg-[#8a0e0e] disabled:opacity-50"
              >
                Analisar
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="bg-stone-900 p-4 rounded-lg border border-stone-800 max-h-64 overflow-y-auto">
              <h3 className="font-bold text-stone-200 mb-2 flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-emerald-400" /> 
                {parsedValid.length} códigos reconhecidos
              </h3>
              
              {parsedValid.length > 0 ? (
                <div className="space-y-2 mt-3">
                  {parsedValid.map(item => {
                    const currentCount = currentCounts[item.id] || 0;
                    const baseCount = Math.max(1, currentCount);
                    const finalCount = baseCount + item.extraCopies;
                    
                    return (
                      <div key={item.id} className="flex justify-between items-center bg-black/40 p-2 rounded text-sm">
                        <span className="font-bold text-stone-300">{stickersMap[item.id]?.label || item.id}</span>
                        <div className="flex items-center gap-2 text-stone-400 text-xs">
                          <span>Atual: {currentCount}</span>
                          <span className="text-emerald-400 font-bold">+{item.extraCopies} extra</span>
                          <span>&rarr; Final: <strong className="text-white">{finalCount}</strong></span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-stone-500">Nenhum código válido encontrado.</p>
              )}

              {parsedInvalid.length > 0 && (
                <div className="mt-4 pt-4 border-t border-stone-800">
                  <h3 className="font-bold text-rose-400 mb-2 flex items-center gap-2 text-sm">
                    <AlertCircle className="w-4 h-4" /> Entradas não reconhecidas ({parsedInvalid.length})
                  </h3>
                  <ul className="text-xs text-stone-500 list-disc pl-4 max-h-20 overflow-y-auto space-y-1">
                    {parsedInvalid.map((inv, idx) => (
                      <li key={idx}>{inv}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="flex gap-3 mt-4">
              <button 
                onClick={() => setIsAnalyzed(false)} 
                disabled={isSaving}
                className="flex-1 py-3 px-4 rounded-xl font-bold border border-stone-700 text-stone-400 hover:bg-stone-800 disabled:opacity-50"
              >
                Editar Texto
              </button>
              <button 
                onClick={handleConfirm}
                disabled={parsedValid.length === 0 || isSaving}
                className="flex-1 py-3 px-4 rounded-xl font-bold bg-[#d4af37] text-black hover:bg-yellow-500 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isSaving ? "Salvando..." : <><Save className="w-4 h-4" /> Confirmar Repetidas</>}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
