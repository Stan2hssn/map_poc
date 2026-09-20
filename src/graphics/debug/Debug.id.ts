export const TAB_ID = {
  MAP: "MAP",
  INK: "INK",
  RENDER: "RENDER",
} as const;

export type TabId = (typeof TAB_ID)[keyof typeof TAB_ID];

export const FOLDER_ID = {
  VIEW: "VIEW",
  CAMERA: "CAMERA",
  LIFE: "LIFE",
  INK: "INK",
  PAPER: "PAPER",
  WATER: "WATER",
  SHADING: "SHADING",
  HOVER: "HOVER",
  STATS: "STATS",
} as const;

export type FolderId = (typeof FOLDER_ID)[keyof typeof FOLDER_ID];
