import type { WebGLRenderer } from "three";
import type { UniverseRegistry } from "../registries/UniverseRegistry/UniverseRegistry.ts";
import Input from "./Input.ts";
import Output from "./Output.ts";
import RAF from "./RAF.ts";
import State from "./State.ts";

/**
 * Runtime - Owns State, Input, Output, RAF, Registry. Orchestration only.
 */
export default class Runtime<Id extends string> {
  private readonly _renderer: WebGLRenderer;
  private readonly _state: State;
  private readonly _input: Input;
  private readonly _output: Output;
  private readonly _raf: RAF;
  private readonly _registry: UniverseRegistry<Id>;

  constructor(
    renderer: WebGLRenderer,
    registry: UniverseRegistry<Id>,
    state: State
  ) {
    this._renderer = renderer;
    this._registry = registry;
    this._state = state;
    this._input = new Input();
    this._output = new Output(this._renderer);
    this._raf = new RAF(this._input, this._output);
  }

  get state(): State {
    return this._state;
  }

  get input(): Input {
    return this._input;
  }

  get output(): Output {
    return this._output;
  }

  get raf(): RAF {
    return this._raf;
  }

  get registry(): UniverseRegistry<Id> {
    return this._registry;
  }

  async setActiveUniverses(ids: Id[]): Promise<void> {
    for (const u of this._output.getActiveUniverses()) {
      await this._output.deactivateUniverse(u);
    }
    for (const id of ids) {
      await this.activateUniverse(id);
    }
  }

  async activateUniverse(id: Id): Promise<void> {
    const u = this._registry.getOrCreate(id);
    if (u) await this._output.activateUniverse(u);
  }

  async deactivateUniverse(id: Id): Promise<void> {
    const u = this._registry.getInstance(id);
    if (u) await this._output.deactivateUniverse(u);
  }

  init(): void {
    this._raf.init();
  }

  start(): void {
    this._raf.start();
  }

  stop(): void {
    this._raf.stop();
  }

  resize(width: number, height: number): void {
    this._raf.resize(width, height);
  }

  dispose(): void {
    this.stop();
    for (const u of this._output.getActiveUniverses()) {
      void this._output.deactivateUniverse(u);
    }
    this._registry.disposeAll();
    this._raf.dispose();
    this._output.dispose();
  }
}
