import type { NodeId } from "@graphics/nodes/Node.id.ts";
import type { DebugManager, DebugSubscriptionOptions } from "../debug/index.ts";
import { InteractionManager } from "../interaction/InteractionManager.ts";
import type { INodeGroup } from "../nodes/group/NodeGroup.interface.ts";
import type { NodeGraph } from "../nodes/NodeGraph.ts";
import type Input from "../systems/Input.ts";
import type IPipeline from "../pipeline/Pipeline.interface.ts";
import type { IUniverseContract } from "./UniverseContract.type.ts";

type PreloadGroupFn = (group: string) => Promise<void>;

export abstract class UniverseBase<Id extends string> {
  readonly id: Id;

  active = false;
  protected _mounted = false;

  protected _scene: unknown;
  protected _camera: unknown;

  protected readonly _graph: NodeGraph;
  protected readonly _pipeline: IPipeline;
  protected readonly _preloadGroup: PreloadGroupFn | null;
  protected readonly _debug: DebugManager | null;
  protected readonly _interaction: InteractionManager | null;
  protected readonly _nodeGroups = new Set<INodeGroup<string, string>>();
  protected readonly _nodeGroupsById = new Map<string, INodeGroup<string, string>>();
  private readonly _debugUnsubscribers = new Set<() => void>();
  private readonly _graphObserversUnsubscribers = new Set<() => void>();

  protected _contracts = new Map<NodeId, IUniverseContract>();
  public _currentContractId: NodeId | null = null;

  /** Prevent concurrent transitions (double-click, spam) */
  protected _isTransitioning = false;
  private _queuedContractId: NodeId | null = null;

  constructor(
    id: Id,
    scene: unknown,
    camera: unknown,
    graph: NodeGraph,
    pipeline: IPipeline,
    preloadGroup: PreloadGroupFn | null = null,
    debug: DebugManager | null = null,
    input: Input | null = null
  ) {
    this.id = id;
    this._scene = scene;
    this._camera = camera;
    this._graph = graph;
    this._pipeline = pipeline;
    this._preloadGroup = preloadGroup;
    this._debug = debug;
    this._interaction = input ? new InteractionManager(input) : null;

    if (this._interaction) {
      this._graphObserversUnsubscribers.add(
        this._graph.addMountObserver((node) => {
          this._interaction?.register(node);
        })
      );
      this._graphObserversUnsubscribers.add(
        this._graph.addUnmountObserver((node) => {
          this._interaction?.unregister(node);
        })
      );
    }
  }

  get mounted(): boolean {
    return this._mounted;
  }

  markMounted(): void {
    this._mounted = true;
  }

  markUnmounted(): void {
    this._mounted = false;
  }

  get graph(): NodeGraph {
    return this._graph;
  }

  getPipeline(): IPipeline {
    return this._pipeline;
  }

  get scene(): unknown {
    return this._scene;
  }

  get camera(): unknown {
    return this._camera;
  }

  setCamera(camera: unknown): void {
    this._camera = camera;
  }

  get currentContractId(): NodeId | null {
    return this._currentContractId;
  }

  /** Helper to register contracts (optional but practical) */
  registerContract(contract: IUniverseContract): void {
    this._contracts.set(contract.id, contract);
  }

  protected registerNodeGroup(group: INodeGroup<string, string>): void {
    this._nodeGroups.add(group);
    this._nodeGroupsById.set(group.id, group);
  }

  protected dispatchNodeGroupEvent(groupId: string, eventType: string, payload?: unknown): void {
    this._nodeGroupsById.get(groupId)?.dispatch(eventType, payload);
  }

  protected dispatchAllNodeGroups(eventType: string, payload?: unknown): void {
    for (const group of this._nodeGroups) {
      group.dispatch(eventType, payload);
    }
  }

  /**
   * Apply contract with lifecycle-based transitions:
   * - exiting nodes: awaited (beforeUnmount) via graph.unmountMany()
   * - entering nodes: mounted, onMounted triggers entry animation (non-awaited)
   *
   * Contracts are DATA ONLY (activeNodeIds).
   */
  async applyContract(nextId: NodeId): Promise<void> {
    // queue while transitioning
    if (this._isTransitioning) {
      this._queuedContractId = nextId;
      return;
    }

    // no-op
    if (this._currentContractId === nextId) return;

    const next = this._contracts.get(nextId);
    if (!next) return;

    this._isTransitioning = true;
    try {
      const prev = this._currentContractId
        ? this._contracts.get(this._currentContractId) ?? null
        : null;

      const prevActive = prev?.activeNodeIds ?? [];
      const nextActive = next.activeNodeIds ?? [];

      const prevSet = new Set(prevActive);
      const nextSet = new Set(nextActive);

      const exiting = prevActive.filter((id) => !nextSet.has(id));
      const entering = nextActive.filter((id) => !prevSet.has(id));

      // Exit first (await), then enter
      // IMPORTANT: unmountMany MUST await node.beforeUnmount in parallel before detaching
      await (this._graph as any).unmountMany(exiting);
      await (this._graph as any).mountMany(entering);

      this._currentContractId = nextId;
    } finally {
      this._isTransitioning = false;

      // apply queued request if any
      if (this._queuedContractId && this._queuedContractId !== this._currentContractId) {
        const queued = this._queuedContractId;
        this._queuedContractId = null;
        await this.applyContract(queued);
      } else {
        this._queuedContractId = null;
      }
    }
  }

  // ──────────────────────────────────────────
  // Universe lifecycle
  // ──────────────────────────────────────────

  beforeMount(): void | Promise<void> {
    // no animation: setup only
    return Promise.resolve(this._preloadAssets()).then(() =>
      Promise.all([
        Promise.resolve(this._beforeMountNodeGroups()),
        Promise.resolve(this._pipeline.beforeMount()),
        Promise.resolve((this._graph as any).beforeMount?.()),
      ]).then(() => { })
    );
  }

  onMounted(): void {
    this._pipeline.onMounted();
    (this._graph as any).onMounted?.();
    this._onMountedNodeGroups();
    this.onDebugMount();
  }

  beforeUnmount(): void | Promise<void> {
    return Promise.all([
      Promise.resolve(this._beforeUnmountNodeGroups()),
      Promise.resolve(this._pipeline.beforeUnmount()),
      Promise.resolve((this._graph as any).beforeUnmount?.()),
    ]).then(() => { });
  }

  onUnmounted(): void {
    this._clearDebugSubscriptions();
    this.onDebugUnmount();
    this._onUnmountedNodeGroups();
    this._pipeline.onUnmounted();
    (this._graph as any).onUnmounted?.();
  }

  // ──────────────────────────────────────────
  // Frame
  // ──────────────────────────────────────────

  update(time: number, dt: number): void {
    this._interaction?.update(this._camera);
    (this._graph as any).update(time, dt);
  }

  resize(width: number, height: number): void {
    this._pipeline.resize(width, height);
    (this._graph as any).resize(width, height);
  }

  dispose(): void {
    this._clearDebugSubscriptions();
    for (const unsubscribe of this._graphObserversUnsubscribers) {
      unsubscribe();
    }
    this._graphObserversUnsubscribers.clear();
    this._interaction?.dispose();
    this._disposeNodeGroups();
    this._pipeline.dispose();
    (this._graph as any).dispose();
  }

  protected onDebugMount(): void {
    //
  }

  protected onDebugUnmount(): void {
    //
  }

  protected debugSubscribe(
    options: Omit<DebugSubscriptionOptions, "ownerId">
  ): () => void {
    if (!this._debug) return () => {};

    const unsubscribe = this._debug.subscribe({
      ownerId: this.id,
      ...options,
    });

    this._debugUnsubscribers.add(unsubscribe);

    return () => {
      unsubscribe();
      this._debugUnsubscribers.delete(unsubscribe);
    };
  }

  protected getAssetPreloadGroups(): string[] {
    return [];
  }

  private async _preloadAssets(): Promise<void> {
    if (!this._preloadGroup) return;
    const groups = this.getAssetPreloadGroups();
    if (groups.length === 0) return;
    await Promise.all(groups.map((group) => this._preloadGroup!(group)));
  }

  private _clearDebugSubscriptions(): void {
    for (const unsubscribe of this._debugUnsubscribers) {
      unsubscribe();
    }
    this._debugUnsubscribers.clear();
  }

  private _beforeMountNodeGroups(): Promise<void> {
    const tasks: Promise<void>[] = [];
    for (const group of this._nodeGroups) {
      group.register(this._graph);
      tasks.push(Promise.resolve(group.beforeMount?.()));
    }
    return Promise.all(tasks).then(() => {});
  }

  private _onMountedNodeGroups(): void {
    for (const group of this._nodeGroups) {
      group.onMounted?.();
    }
  }

  private _beforeUnmountNodeGroups(): Promise<void> {
    const tasks: Promise<void>[] = [];
    for (const group of this._nodeGroups) {
      tasks.push(Promise.resolve(group.beforeUnmount?.()));
    }
    return Promise.all(tasks).then(() => {});
  }

  private _onUnmountedNodeGroups(): void {
    for (const group of this._nodeGroups) {
      group.onUnmounted?.();
    }
  }

  private _disposeNodeGroups(): void {
    for (const group of this._nodeGroups) {
      group.dispose?.();
    }
    this._nodeGroups.clear();
    this._nodeGroupsById.clear();
  }
}
