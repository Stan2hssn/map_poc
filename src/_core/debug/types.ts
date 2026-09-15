import type { FolderApi, TabPageApi } from "tweakpane";

export type TabId = string;
export type FolderId = string;

export interface DebugTabConfig {
  id: TabId;
  label: string;
  visible: boolean;
  order?: number;
}

export interface DebugFolderConfig {
  id: FolderId;
  tabId: TabId;
  label: string;
  visible: boolean;
  expanded?: boolean;
  order?: number;
}

export interface DebugConfig {
  tabs: DebugTabConfig[];
  folders: DebugFolderConfig[];
  /**
   * Prefixe des drapeaux d'URL retenus en session (`<prefixe>:debug`).
   * `sessionStorage` est partage par origine : deux projets servis sur
   * `localhost` se passeraient sinon leurs drapeaux.
   */
  sessionPrefix?: string;
}

export type DebugTarget = TabPageApi | FolderApi;

/**
 * Ce que rend `addBinding`.
 *
 * `tweakpane` n'exporte pas le nom `BindingApi` : on deduit le type de la
 * methode elle-meme plutot que de le retaper, sinon une montee de version le
 * ferait diverger en silence.
 */
export type DebugBinding = ReturnType<FolderApi["addBinding"]>;

export interface DebugSubscriptionOptions {
  ownerId: string;
  tabId: TabId;
  folderId?: FolderId;
  mount: (target: DebugTarget) => void | (() => void);
}
