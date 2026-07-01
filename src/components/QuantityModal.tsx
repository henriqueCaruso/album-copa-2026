import React, { useState } from "react";
import { X } from "lucide-react";
import { stickersMap } from "../data";

interface QuantityModalProps {
  stickerId: string;
  currentCount: number;
  onClose: () => void;
  onSave: (newCount: number) => void;
}

export const QuantityModal: React.FC<QuantityModalProps> = ({ stickerId, currentCount, onClose, onSave }) => {
  const [val, setVal] = useState<string>(currentCount.toString());
  const label = stickersMap[stickerId]?.label || stickerId;

  const handleSave = () => {
    let parsed = parseInt(val, 10);
    if (isNaN(parsed) || parsed < 0) parsed = 0;
    // max reasonable
    if (parsed > 999) parsed = 999;
    onSave(parsed);
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-[#1a0505] border border-stone-800 rounded-2xl p-5 w-full max-w-xs shadow-2xl relative">
        <button onClick={onClose} className="absolute top-3 right-3 p-1.5 text-stone-400 hover:text-white bg-stone-900 rounded-full">
          <X className="w-4 h-4" />
        </button>
        <h3 className="text-stone-200 font-bold mb-1">{label}</h3>
        <p className="text-xs text-stone-500 mb-4">Definir quantidade exata:</p>
        
        <input 
          type="number" 
          value={val}
          onChange={(e) => setVal(e.target.value)}
          min={0}
          max={999}
          className="w-full bg-stone-900 border border-stone-700 text-stone-200 rounded-lg p-3 text-center text-xl font-bold mb-4 focus:outline-none focus:border-[#d4af37]"
        />
        
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2 px-3 rounded-lg font-bold border border-stone-700 text-stone-400 hover:bg-stone-800">
            Cancelar
          </button>
          <button onClick={handleSave} className="flex-1 py-2 px-3 rounded-lg font-bold bg-[#6b0b0b] text-white hover:bg-[#8a0e0e]">
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
};
