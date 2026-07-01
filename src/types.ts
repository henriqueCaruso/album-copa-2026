export interface UserProfile {
  uid: string;
  name: string;
  email: string;
  photoURL: string;
  createdAt: any; // Firebase Timestamp or ISO string
}

export interface UserAlbum {
  userId: string;
  ownedStickers: string[];
  repeatedStickers: string[];
  repeatedCounts?: Record<string, number>;
  lastUpdated: any; // Firebase Timestamp or ISO string
  progressPercent: number;
}

export interface TradeShare {
  shareId: string;
  ownerUid: string;
  displayName: string;
  photoURL?: string;
  missingStickerIds: string[];
  repeatedCounts: Record<string, number>;
  updatedAt: any; // Firebase Timestamp or ISO string
  expiresAt: any; // Firebase Timestamp or ISO string
  isPublic: boolean;
}

export interface ActivityLog {
  userId: string;
  type: "stickers_added" | "milestone" | "trade" | "progress_recovery";
  description?: string;
  timestamp: any; // Firebase Timestamp or ISO string;
  [key: string]: any; // Allow arbitrary keys for specific types like recovery details
}

export interface AlbumSection {
  id: string;
  name: string;
  prefix: string;
  stickersCount: number;
  group: string;
  special?: boolean;
}

export interface Country {
  id: string;
  name: string;
  iso2: string;
  fifaCode: string;
  group: string;
  flagUrl?: string;
  pages: AlbumPage[];
  special?: boolean;
}

export interface AlbumPage {
  id: string;
  countryId: string;
  title: string;
  stickerIds: string[];
  order: number;
}

export interface StickerDefinition {
  id: string;
  countryId: string;
  pageId: string;
  number: number;
  label?: string;
  type?: "player" | "team" | "special" | "stadium" | "other";
}

