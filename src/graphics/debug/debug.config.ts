import type { DebugConfig } from "@_core/debug/index.ts";
import { FOLDER_ID, TAB_ID } from "./Debug.id.ts";

export const DEBUG_CONFIG: DebugConfig = {
  // Prefixe des drapeaux `?debug` / `?stats` retenus en session.
  sessionPrefix: "map",
  tabs: [
    { id: TAB_ID.MAP, label: "Carte", visible: true, order: 1 },
    { id: TAB_ID.INK, label: "Dessin", visible: true, order: 2 },
    { id: TAB_ID.RENDER, label: "Rendu", visible: true, order: 3 },
  ],
  folders: [
    { id: FOLDER_ID.VIEW, tabId: TAB_ID.MAP, label: "Vue", visible: true, expanded: true, order: 1 },
    { id: FOLDER_ID.LIFE, tabId: TAB_ID.MAP, label: "Vie", visible: true, expanded: true, order: 2 },
    { id: FOLDER_ID.CAMERA, tabId: TAB_ID.MAP, label: "Camera et soleil", visible: true, expanded: false, order: 3 },
    { id: FOLDER_ID.INK, tabId: TAB_ID.INK, label: "Encre", visible: true, expanded: true, order: 1 },
    { id: FOLDER_ID.PAPER, tabId: TAB_ID.INK, label: "Papier", visible: true, expanded: true, order: 2 },
    { id: FOLDER_ID.WATER, tabId: TAB_ID.INK, label: "Eau", visible: true, expanded: true, order: 3 },
    { id: FOLDER_ID.HOVER, tabId: TAB_ID.INK, label: "Survol", visible: true, expanded: false, order: 4 },
    { id: FOLDER_ID.SHADING, tabId: TAB_ID.INK, label: "Ombrage du bati", visible: true, expanded: false, order: 4 },
    { id: FOLDER_ID.STATS, tabId: TAB_ID.RENDER, label: "Mesures", visible: true, expanded: true, order: 1 },
  ],
};
