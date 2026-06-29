import { AlbumSection } from "./types";

export const missingFromPhotos: Record<string, number[]> = {
  "FWC": [3, 7, 8, 9, 10, 11, 13, 15, 17],
  "CC": [4, 6, 10],
  "MEX": [1, 3, 6, 10, 11, 13, 15, 18, 19, 20],
  "RSA": [8, 12, 13, 15, 16],
  "ENG": [1, 2, 3, 5, 7, 9, 10, 12, 13, 15, 17, 19, 20],
  "COL": [6, 8, 10, 13, 14, 16, 18],
  "CRO": [1, 7, 13, 15, 16, 19],
  "PAN": [2, 3, 5, 7, 8, 12, 17, 19, 20],
  "COD": [2, 3, 5, 8, 10, 11, 13, 15, 16, 17, 18, 19, 20],
  "GHA": [1, 2, 3, 7, 11, 15, 17, 19, 20],
  "UZB": [1, 2, 3, 6, 7, 9, 11, 14, 17],
  "POR": [3, 4, 5, 7, 10, 15, 19],
  "JOR": [8, 13],
  "AUT": [3, 5, 7, 8, 9, 12, 13, 14, 15],
  "ALG": [2, 3, 6, 7, 9, 11, 15, 16, 18, 19, 20],
  "ARG": [1, 3, 4, 6, 9, 13, 14, 15, 18, 20],
  "NOR": [1, 2, 3, 5, 7, 13, 15, 16, 18, 19, 20],
  "IRQ": [3, 4, 15, 18],
  "SEN": [1, 4, 7, 10, 11, 12, 13, 14, 20],
  "FRA": [1, 2, 3, 4, 6, 7, 10, 11, 12, 15, 16, 17, 19],
  "URU": [2, 3, 4, 5, 7, 9, 14, 16, 20],
  "KSA": [3, 5, 6, 11, 12, 15, 16, 19],
  "CPV": [1, 3, 4, 5, 7, 9, 11, 12, 14, 16, 17, 20],
  "ESP": [1, 2, 4, 5, 10, 12, 14, 18, 19],
  "NZL": [3, 4, 5, 6, 9, 11, 14, 20],
  "EGY": [2, 4, 6, 8, 9, 11, 12, 14, 15, 17, 18, 19],
  "IRN": [3, 5, 6, 7, 9, 11, 12, 13, 15, 16, 19, 20],
  "BEL": [6, 9, 10, 12, 16, 19, 20],
  "TUN": [1, 3, 7, 9, 13, 16, 20],
  "SWE": [8, 9, 10, 13, 16, 18, 19],
  "JPN": [3, 7, 11, 12, 16, 17, 19, 20],
  "NED": [1, 2, 8, 9, 13, 20],
  "ECU": [10, 12, 13, 15, 17, 19],
  "CIV": [5, 6, 7, 8, 9, 12, 17, 20],
  "CUW": [4, 5, 6, 7, 8, 12, 13],
  "GER": [4, 6],
  "AUS": [2, 3, 6, 10, 11, 17, 20],
  "PAR": [1, 2, 4, 6, 10, 13, 18, 19],
  "TUR": [3, 5, 7, 9, 11, 13, 19, 20],
  "USA": [3, 7, 8, 9, 13, 14],
  "SCO": [5, 6, 8, 12, 15],
  "QAT": [1],
  "MAR": [1, 4, 7, 8, 12, 16, 18],
  "CZE": [1, 2, 3, 5, 7, 8, 9, 10, 11, 13, 14, 19, 20],
  "BIH": [1, 3, 7, 9, 12, 16, 17, 18, 19],
  "BRA": [6, 8, 13, 17],
  "KOR": [1, 3, 5, 8, 9, 10, 12, 13, 14, 15, 16, 17, 18, 19, 20],
  "HAI": [1, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13, 14, 17, 19, 20],
  "SUI": [1, 5, 8, 9, 13, 15, 17, 18],
  "CAN": [2, 3, 6, 9, 10, 12, 14, 16, 17, 20]
};

export const albumSections: AlbumSection[] = [
  { id: "FWC", name: "🏛️ Especiais & Símbolos", prefix: "FWC", stickersCount: 18, group: "especiais", special: true },
  { id: "CC", name: "🥤 Coca-Cola Momentos", prefix: "CC", stickersCount: 10, group: "especiais", special: true },
  
  // Grupo A
  { id: "MEX", name: "🇲🇽 México", prefix: "MEX", stickersCount: 20, group: "A" },
  { id: "RSA", name: "🇿🇦 África do Sul", prefix: "RSA", stickersCount: 20, group: "A" },
  { id: "KOR", name: "🇰🇷 Coreia do Sul", prefix: "KOR", stickersCount: 20, group: "A" },
  { id: "CZE", name: "🇨🇿 Tchéquia", prefix: "CZE", stickersCount: 20, group: "A" },

  // Grupo B
  { id: "CAN", name: "🇨🇦 Canadá", prefix: "CAN", stickersCount: 20, group: "B" },
  { id: "BIH", name: "🇧🇦 Bósnia e Herzegovina", prefix: "BIH", stickersCount: 20, group: "B" },
  { id: "QAT", name: "🇶🇦 Qatar", prefix: "QAT", stickersCount: 20, group: "B" },
  { id: "SUI", name: "🇨🇭 Suíça", prefix: "SUI", stickersCount: 20, group: "B" },

  // Grupo C
  { id: "BRA", name: "🇧🇷 Brasil", prefix: "BRA", stickersCount: 20, group: "C" },
  { id: "MAR", name: "🇲🇦 Marrocos", prefix: "MAR", stickersCount: 20, group: "C" },
  { id: "HAI", name: "🇭🇹 Haiti", prefix: "HAI", stickersCount: 20, group: "C" },
  { id: "SCO", name: "🏴󠁧󠁢󠁳󠁣󠁴󠁿 Escócia", prefix: "SCO", stickersCount: 20, group: "C" },

  // Grupo D
  { id: "USA", name: "🇺🇸 Estados Unidos", prefix: "USA", stickersCount: 20, group: "D" },
  { id: "PAR", name: "🇵🇾 Paraguai", prefix: "PAR", stickersCount: 20, group: "D" },
  { id: "AUS", name: "🇦🇺 Austrália", prefix: "AUS", stickersCount: 20, group: "D" },
  { id: "TUR", name: "🇹🇷 Turquia", prefix: "TUR", stickersCount: 20, group: "D" },

  // Grupo E
  { id: "GER", name: "🇩🇪 Alemanha", prefix: "GER", stickersCount: 20, group: "E" },
  { id: "CUW", name: "🇨🇼 Curaçao", prefix: "CUW", stickersCount: 20, group: "E" },
  { id: "CIV", name: "🇨🇮 Costa do Marfim", prefix: "CIV", stickersCount: 20, group: "E" },
  { id: "ECU", name: "🇪🇨 Equador", prefix: "ECU", stickersCount: 20, group: "E" },

  // Grupo F
  { id: "NED", name: "🇳🇱 Holanda", prefix: "NED", stickersCount: 20, group: "F" },
  { id: "JPN", name: "🇯🇵 Japão", prefix: "JPN", stickersCount: 20, group: "F" },
  { id: "SWE", name: "🇸🇪 Suécia", prefix: "SWE", stickersCount: 20, group: "F" },
  { id: "TUN", name: "🇹🇳 Tunísia", prefix: "TUN", stickersCount: 20, group: "F" },

  // Grupo G
  { id: "BEL", name: "🇧🇪 Bélgica", prefix: "BEL", stickersCount: 20, group: "G" },
  { id: "EGY", name: "🇪🇬 Egito", prefix: "EGY", stickersCount: 20, group: "G" },
  { id: "IRN", name: "🇮🇷 Irã", prefix: "IRN", stickersCount: 20, group: "G" },
  { id: "NZL", name: "🇳🇿 Nova Zelândia", prefix: "NZL", stickersCount: 20, group: "G" },

  // Grupo H
  { id: "ESP", name: "🇪🇸 Espanha", prefix: "ESP", stickersCount: 20, group: "H" },
  { id: "CPV", name: "🇨🇻 Cabo Verde", prefix: "CPV", stickersCount: 20, group: "H" },
  { id: "KSA", name: "🇸🇦 Arábia Saudita", prefix: "KSA", stickersCount: 20, group: "H" },
  { id: "URU", name: "🇺🇾 Uruguai", prefix: "URU", stickersCount: 20, group: "H" },

  // Grupo I
  { id: "FRA", name: "🇫🇷 França", prefix: "FRA", stickersCount: 20, group: "I" },
  { id: "SEN", name: "🇸🇳 Senegal", prefix: "SEN", stickersCount: 20, group: "I" },
  { id: "IRQ", name: "🇮🇶 Iraque", prefix: "IRQ", stickersCount: 20, group: "I" },
  { id: "NOR", name: "🇳🇴 Noruega", prefix: "NOR", stickersCount: 20, group: "I" },

  // Grupo J
  { id: "ARG", name: "🇦🇷 Argentina", prefix: "ARG", stickersCount: 20, group: "J" },
  { id: "ALG", name: "🇩🇿 Argélia", prefix: "ALG", stickersCount: 20, group: "J" },
  { id: "AUT", name: "🇦🇹 Áustria", prefix: "AUT", stickersCount: 20, group: "J" },
  { id: "JOR", name: "🇯🇴 Jordânia", prefix: "JOR", stickersCount: 20, group: "J" },

  // Grupo K
  { id: "POR", name: "🇵🇹 Portugal", prefix: "POR", stickersCount: 20, group: "K" },
  { id: "COD", name: "🇨🇩 República Democrática do Congo", prefix: "COD", stickersCount: 20, group: "K" },
  { id: "UZB", name: "🇺🇿 Uzbequistão", prefix: "UZB", stickersCount: 20, group: "K" },
  { id: "COL", name: "🇨🇴 Colômbia", prefix: "COL", stickersCount: 20, group: "K" },

  // Grupo L
  { id: "ENG", name: "🏴󠁧󠁢󠁥󠁮󠁧󠁿 Inglaterra", prefix: "ENG", stickersCount: 20, group: "L" },
  { id: "CRO", name: "🇭🇷 Croácia", prefix: "CRO", stickersCount: 20, group: "L" },
  { id: "GHA", name: "🇬🇭 Gana", prefix: "GHA", stickersCount: 20, group: "L" },
  { id: "PAN", name: "🇵🇦 Panamá", prefix: "PAN", stickersCount: 20, group: "L" }
];

export const totalAlbumStickers: string[] = [];
albumSections.forEach(section => {
  for (let i = 1; i <= section.stickersCount; i++) {
    totalAlbumStickers.push(`${section.prefix}_${i}`);
  }
});

export const TOTAL_STICKERS = totalAlbumStickers.length;
