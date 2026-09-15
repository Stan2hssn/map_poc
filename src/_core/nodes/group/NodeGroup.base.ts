import type Input from "@_core/systems/Input.ts";
import type { InputEventPayloadMap } from "@_core/systems/Input.ts";
import type { NodeGraph } from "@_core/nodes/NodeGraph.ts";
import { GroupNodeBase } from "./GroupNode.base.ts";
import type { INodeGroup } from "./NodeGroup.interface.ts";

export abstract class NodeGroupBase<
  Id extends string = string,
  ItemId extends string = string,
> extends GroupNodeBase<Id, ItemId> implements INodeGroup<Id, ItemId>
{
  private _registered = false;
  private readonly _listeners = new Map<string, Set<(payload?: unknown) => void>>();
  protected readonly _input: Input | null;
  private readonly _inputUnsubscribers = new Set<() => void>();

  constructor(id: Id, itemIds: ItemId[] = [], input: Input | null = null) {
    super(id, itemIds);
    this._input = input;
  }

  register(graph: NodeGraph): void {
    if (this._registered) return;
    graph.addMany(this.getNodes());
    this._registered = true;
  }

  subscribe(eventType: string, handler: (payload?: unknown) => void): () => void {
    if (!this._listeners.has(eventType)) {
      this._listeners.set(eventType, new Set());
    }
    const listeners = this._listeners.get(eventType)!;
    listeners.add(handler);

    return () => {
      listeners.delete(handler);
      if (listeners.size === 0) {
        this._listeners.delete(eventType);
      }
    };
  }

  dispatch(eventType: string, payload?: unknown): void {
    this.onGroupEvent(eventType, payload);
    const listeners = this._listeners.get(eventType);
    if (!listeners) return;
    for (const handler of listeners) {
      handler(payload);
    }
  }

  beforeMount(): void | Promise<void> {
    //
  }

  onMounted(): void {
    this.onInputMount();
  }

  beforeUnmount(): void | Promise<void> {
    //
  }

  onUnmounted(): void {
    this._clearInputSubscriptions();
    this.onInputUnmount();
  }

  dispose(): void {
    this._clearInputSubscriptions();
    this._listeners.clear();
  }

  protected onGroupEvent(_eventType: string, _payload?: unknown): void {
    //
  }

  protected onInputMount(): void {
    //
  }

  protected onInputUnmount(): void {
    //
  }

  protected inputSubscribe<K extends keyof InputEventPayloadMap>(
    eventType: K,
    handler: (payload: InputEventPayloadMap[K]) => void
  ): () => void {
    if (!this._input) return () => {};

    const unsubscribe = this._input.subscribe(eventType, handler);
    this._inputUnsubscribers.add(unsubscribe);

    return () => {
      unsubscribe();
      this._inputUnsubscribers.delete(unsubscribe);
    };
  }

  private _clearInputSubscriptions(): void {
    for (const unsubscribe of this._inputUnsubscribers) {
      unsubscribe();
    }
    this._inputUnsubscribers.clear();
  }

  abstract getNodes(): import("@_core/nodes/Node.interface.ts").default[];
}
