import { EventInput } from "@_core/helpers/event/Input.events.ts";
import type Input from "@_core/systems/Input.ts";
import type { InputEventPayloadMap } from "@_core/systems/Input.ts";
import type INode from "./Node.interface.ts";

export abstract class NodeBase implements INode {
  readonly id: string;
  readonly name: string;

  active = true;
  mounted = false;

  protected readonly _input: Input | null;
  private readonly _inputUnsubscribers = new Set<() => void>();

  constructor(id: string, name: string, input: Input | null = null) {
    this.id = id;
    this.name = name;
    this._input = input;
  }

  beforeMount(): void | Promise<void> {
    //
  }

  onMounted(): void {
    this.mounted = true;
    this.onInputMount();
  }

  beforeUnmount(): void | Promise<void> {
    //
  }

  onUnmounted(): void {
    this._clearInputSubscriptions();
    this.onInputUnmount();
    this.mounted = false;
  }

  update(_time: number, _dt: number): void {
    //
  }

  resize(_width: number, _height: number): void {
    //
  }

  dispose(): void {
    this._clearInputSubscriptions();
  }

  protected onInputMount(): void {
    //
  }

  protected onInputUnmount(): void {
    //
  }

  protected inputSubscribe<K extends keyof InputEventPayloadMap>(
    eventType: EventInput | K,
    handler: (payload: InputEventPayloadMap[K]) => void
  ): () => void {
    if (!this._input) return () => { };

    const unsubscribe = this._input.subscribe(eventType as K, handler);
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
}
