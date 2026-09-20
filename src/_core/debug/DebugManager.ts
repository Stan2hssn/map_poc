import { Pane, type FolderApi, type TabPageApi } from "tweakpane";
import { DebugValueStore, applyValue } from "./DebugValues.ts";
import type { DebugPersistence } from "./DebugValues.ts";
import type {
  DebugBinding,
  DebugConfig,
  DebugSubscriptionOptions,
  DebugTarget,
} from "./types.ts";

type InternalSubscription = DebugSubscriptionOptions & {
  key: number;
  cleanup: (() => void) | null;
};

function byOrder<T extends { order?: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
}

/**
 * Ce que rend `bind` quand il n'y a pas de panneau : un controle qui accepte
 * tout et ne fait rien.
 *
 * Rendre `null` obligerait chaque appelant a se garder, et il suffirait d'un
 * oubli pour casser la passe d'application — celle-la meme qui doit tourner en
 * production.
 */
const INERT_BINDING = {
  dispose: () => undefined,
  on: () => INERT_BINDING,
  refresh: () => undefined,
} as unknown as DebugBinding;

export class DebugManager {
  private _pane: Pane | null = null;
  private _config: DebugConfig | null = null;
  private _visible = true;
  private _nextSubKey = 1;
  private _subscriptions = new Map<number, InternalSubscription>();
  private _tabApis = new Map<string, TabPageApi>();
  private _folderApis = new Map<string, FolderApi>();
  private _knownTabIds = new Set<string>();
  private _knownFolderIds = new Set<string>();
  private _isInitialized = false;
  private readonly _snapshotProviders = new Map<string, () => Record<string, unknown>>();
  private readonly _values = new DebugValueStore();

  /**
   * A appeler AVANT `init` : les bindings relisent leur valeur au montage, et
   * `init` monte immediatement les abonnements deja enregistres.
   */
  setPersistence(persistence: DebugPersistence): void {
    this._values.configure(persistence);
  }

  init(config: DebugConfig): void {
    if (this._isInitialized) return;
    this._isInitialized = true;
    this._config = config;
    this._createPane();
    this._buildTree();
    this._mountAllVisibleSubscriptions();
  }

  /**
   * Binding PERSISTANT : la valeur enregistree est reposee sur la cible avant
   * la creation du controle, et toute modification y repart.
   *
   * `target` PEUT ETRE NUL, et c'est le point. Les valeurs sont la
   * configuration de la scene, pas un etat du panneau : elles doivent
   * s'appliquer que celui-ci existe ou non. Un appel sans cible pose la valeur
   * et rend un controle inerte, ce qui permet de declarer les reglages UNE fois
   * et de les consommer deux — une passe d'application au demarrage, une
   * construction de panneau quand il est demande.
   *
   * Sans `path`, c'est un `addBinding` ordinaire : tout ne merite pas d'etre
   * conserve, un compteur en lecture seule par exemple.
   */
  bind(
    target: DebugTarget | null,
    object: Record<string, unknown>,
    key: string,
    options: Record<string, unknown>,
    path?: string
  ): DebugBinding {
    if (path !== undefined) {
      const saved = this._values.read(path);
      if (saved !== undefined) applyValue(object, key, saved);
    }

    if (target === null) return INERT_BINDING;

    const binding = target.addBinding(object, key, options);

    if (path !== undefined) {
      binding.on("change", (event) => {
        this._values.write(path, event.value);
      });
    }

    return binding;
  }

  /** Valeur enregistree pour ce chemin, `undefined` si aucune. */
  getSavedValue(path: string): unknown {
    return this._values.read(path);
  }

  /** Ecriture hors binding, pour un reglage pilote par du code. */
  setSavedValue(path: string, value: unknown): void {
    this._values.write(path, value);
  }

  setConfig(config: DebugConfig): void {
    this._config = config;
    if (!this._isInitialized) return;
    this._unmountAllSubscriptions();
    this._buildTree();
    this._mountAllVisibleSubscriptions();
  }

  subscribe(options: DebugSubscriptionOptions): () => void {
    const key = this._nextSubKey++;
    const sub: InternalSubscription = { ...options, key, cleanup: null };
    this._subscriptions.set(key, sub);

    if (this._isInitialized) {
      this._mountSubscriptionIfVisible(sub);
    }

    return () => {
      const current = this._subscriptions.get(key);
      if (!current) return;
      current.cleanup?.();
      this._subscriptions.delete(key);
    };
  }

  registerSnapshot(id: string, provider: () => Record<string, unknown>): () => void {
    this._snapshotProviders.set(id, provider);
    return () => { this._snapshotProviders.delete(id); };
  }

  setVisible(visible: boolean): void {
    this._visible = visible;
    if (!this._pane?.element) return;
    const root = this._pane.element.closest(".tp-dfwv") as HTMLElement | null;
    const target = root ?? this._pane.element;
    target.style.display = visible ? "block" : "none";
  }

  toggle(): void {
    this.setVisible(!this._visible);
  }

  dispose(): void {
    this._unmountAllSubscriptions();
    this._subscriptions.clear();
    this._tabApis.clear();
    this._folderApis.clear();
    this._knownTabIds.clear();
    this._knownFolderIds.clear();
    if (this._pane) {
      this._pane.dispose();
      this._pane = null;
    }
    this._isInitialized = false;
  }

  private _createPane(): void {
    if (this._pane) {
      this._pane.dispose();
      this._pane = null;
    }

    this._pane = new Pane({
      title: "Debug",
      expanded: true,
      container: document.body,
    });

    const root = this._pane.element.closest(".tp-dfwv") as HTMLElement | null;
    const target = root ?? this._pane.element;
    target.style.position = "fixed";
    target.style.top = "10px";
    target.style.right = "10px";
    target.style.zIndex = "10000";
    target.style.maxHeight = "80vh";
    target.style.overflow = "auto";
    target.style.minWidth = "320px";
    target.style.display = this._visible ? "block" : "none";
  }

  private _buildTree(): void {
    if (!this._pane || !this._config) return;

    this._createPane();
    this._tabApis.clear();
    this._folderApis.clear();
    this._knownTabIds.clear();
    this._knownFolderIds.clear();

    this._pane.addButton({ title: "Copy All Config" }).on("click", () => {
      const snapshot: Record<string, unknown> = {};
      for (const [id, provider] of this._snapshotProviders) {
        snapshot[id] = provider();
      }
      const text = JSON.stringify(snapshot, null, 2);
      void navigator.clipboard.writeText(text);
      console.log("[Debug] All config copied:\n", text);
    });

    // Seul ce bouton enregistre : les curseurs ne valent que pour la session.
    this._pane.addButton({ title: "Save Settings" }).on("click", () => {
      this._values.flush();
      console.log("[Debug] settings written:\n", JSON.stringify(this._values.snapshot(), null, 2));
    });

    const visibleTabs = byOrder(this._config.tabs).filter((tab) => tab.visible);
    const tabsById = new Map(this._config.tabs.map((tab) => [tab.id, tab]));
    const visibleTabIds = new Set(visibleTabs.map((tab) => tab.id));

    for (const tab of this._config.tabs) {
      this._knownTabIds.add(tab.id);
    }
    for (const folder of this._config.folders) {
      this._knownFolderIds.add(folder.id);
    }

    if (visibleTabs.length === 0) return;

    const tabApi = this._pane.addTab({
      pages: visibleTabs.map((tab) => ({ title: tab.label })),
    });

    visibleTabs.forEach((tab, index) => {
      this._tabApis.set(tab.id, tabApi.pages[index]);
    });

    const visibleFolders = byOrder(this._config.folders).filter(
      (folder) => folder.visible && visibleTabIds.has(folder.tabId)
    );

    for (const folder of visibleFolders) {
      const tab = tabsById.get(folder.tabId);
      if (!tab) continue;
      const page = this._tabApis.get(tab.id);
      if (!page) continue;
      const folderApi = page.addFolder({
        title: folder.label,
        expanded: folder.expanded ?? true,
      });
      this._folderApis.set(folder.id, folderApi);
    }
  }

  private _mountAllVisibleSubscriptions(): void {
    for (const sub of this._subscriptions.values()) {
      this._mountSubscriptionIfVisible(sub);
    }
  }

  private _unmountAllSubscriptions(): void {
    for (const sub of this._subscriptions.values()) {
      sub.cleanup?.();
      sub.cleanup = null;
    }
  }

  private _mountSubscriptionIfVisible(sub: InternalSubscription): void {
    if (sub.cleanup) return;

    if (!this._knownTabIds.has(sub.tabId)) {
      console.warn(`[debug] Unknown tabId "${sub.tabId}" from "${sub.ownerId}"`);
      return;
    }

    let target: TabPageApi | FolderApi | undefined = this._tabApis.get(sub.tabId);

    if (sub.folderId) {
      if (!this._knownFolderIds.has(sub.folderId)) {
        console.warn(`[debug] Unknown folderId "${sub.folderId}" from "${sub.ownerId}"`);
        return;
      }
      target = this._folderApis.get(sub.folderId);
    }

    if (!target) return;

    const cleanup = sub.mount(target);
    sub.cleanup = typeof cleanup === "function" ? cleanup : null;
  }
}
