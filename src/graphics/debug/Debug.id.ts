export const TAB_ID = {
  UNIVERSE: "UNIVERSE",
  RENDER: "RENDER",
} as const;

export type TabId = (typeof TAB_ID)[keyof typeof TAB_ID];

export const FOLDER_ID = {
  UNIVERSE_MAIN: "UNIVERSE_MAIN",
  BUILDINGS: "BUILDINGS",
  INK: "INK",
  PARALLAX: "PARALLAX",
  STATS: "STATS",
} as const;

export type FolderId = (typeof FOLDER_ID)[keyof typeof FOLDER_ID];
