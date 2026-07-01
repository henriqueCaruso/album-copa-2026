import { stickersMap } from "../data";

export interface ParsedSticker {
  id: string;
  extraCopies: number;
}

export function parseQuickAddInput(input: string): { valid: ParsedSticker[], invalid: string[] } {
  const result: Record<string, number> = {};
  const invalid: Set<string> = new Set();

  // Normalize separators: commas, semicolons to newlines
  let normalized = input.replace(/[,;]/g, '\n');
  
  const lines = normalized.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  for (const line of lines) {
    // Regex to match "BRA 1", "BRA_1", "BRA-1", "BRA 1-5", with optional "x2", "2x"
    // Also multiple codes in one line if space separated, though we split by comma/semicolon above.
    // Let's just process word-like chunks from the line if there are multiple.
    // Actually, a line might be "BRA 1 BRA 2 x2" which is ambiguous.
    // But the instructions say: "BRA 1, BRA 2, BRA 3", "ARG_7, ARG_7", etc.
    // Let's extract patterns like: (COUNTRY) [ _-] (NUMBERS) (optional multiplier)
    
    // A simpler approach: split by spaces unless it's between country and number.
    // Let's first clean up the line.
    let upperLine = line.toUpperCase();
    
    // Look for explicit tokens. A token is roughly CountryCode + Number.
    // Wait, regex might be easier.
    // (A-Z]{2,3})[\s_-]+(\d+)(?:\s*-\s*(\d+))?(?:\s*(?:x(\d+)|(\d+)x))?
    // Let's iterate all matches globally in the line.
    const regex = /([A-Z]{2,3})[\s_-]+(\d+)(?:\s*-\s*(\d+))?(?:\s*(?:X(\d+)|(\d+)X))?/g;
    
    let match;
    let foundValid = false;
    
    // If the line has no valid matches, we might mark the whole line as invalid, or maybe we just extract matches.
    // Let's try to extract all valid matches.
    const matches = Array.from(upperLine.matchAll(regex));
    
    if (matches.length > 0) {
       for (const m of matches) {
         const prefix = m[1];
         const startNum = parseInt(m[2], 10);
         const endNum = m[3] ? parseInt(m[3], 10) : startNum;
         
         let mult = 1;
         if (m[4]) mult = parseInt(m[4], 10);
         else if (m[5]) mult = parseInt(m[5], 10);
         
         for (let i = startNum; i <= endNum; i++) {
            const id = `${prefix}_${i}`;
            if (stickersMap[id]) {
               result[id] = (result[id] || 0) + mult;
               foundValid = true;
            } else {
               invalid.add(m[0].trim());
            }
         }
       }
    }
    
    if (!foundValid && upperLine.trim().length > 0) {
       // if we found nothing valid in this chunk, maybe add the chunk to invalid
       invalid.add(line);
    }
  }

  const valid = Object.keys(result).map(id => ({ id, extraCopies: result[id] }));
  return { valid, invalid: Array.from(invalid) };
}
