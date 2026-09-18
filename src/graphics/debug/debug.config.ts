import type { DebugConfig } from "@_core/debug/index.ts";
import { FOLDER_ID, TAB_ID } from "./Debug.id.ts";

export const DEBUG_CONFIG: DebugConfig = {
  // Prefixe des drapeaux `?debug` / `?stats` retenus en session.
  sessionPrefix: "map",
  tabs: [
    { id: TAB_ID.UNIVERSE, label: "Universe", visible: true, order: 1 },
    { id: TAB_ID.RENDER, label: "Render", visible: true, order: 2 },
  ],
  folders: [
    {
      id: FOLDER_ID.UNIVERSE_MAIN,
      tabId: TAB_ID.UNIVERSE,
      label: "Main Universe",
      visible: true,
      expanded: true,
      order: 1,
    },
    {
      id: FOLDER_ID.BUILDINGS,
      tabId: TAB_ID.UNIVERSE,
      label: "Elevations",
      visible: true,
      expanded: true,
      order: 2,
    },
    {
      id: FOLDER_ID.INK,
      tabId: TAB_ID.UNIVERSE,
      label: "Encre",
      visible: true,
      expanded: true,
      order: 3,
    },
    {
      id: FOLDER_ID.STATS,
      tabId: TAB_ID.RENDER,
      label: "Stats",
      visible: true,
      expanded: false,
      order: 1,
    },
  ],
};
