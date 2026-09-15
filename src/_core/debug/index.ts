import { DebugManager } from "./DebugManager.ts";

export { DebugManager } from "./DebugManager.ts";
export { DebugValueStore, applyValue, isStorable, serialize } from "./DebugValues.ts";
export type { DebugPersistence, DebugValues } from "./DebugValues.ts";
export type {
  DebugBinding,
  DebugConfig,
  DebugFolderConfig,
  DebugSubscriptionOptions,
  DebugTabConfig,
  DebugTarget,
  FolderId,
  TabId,
} from "./types.ts";

export const debug = new DebugManager();
