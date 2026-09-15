import type { UniverseBase } from "../../universes/Universe.base.ts";

export type UniverseCtor<Id extends string> = () => UniverseBase<Id>;

/**
 * Lazy registry: definitions (id → ctor) + instances (created on getOrCreate).
 * Does NOT manage lifecycle or update/render.
 */
export class UniverseRegistry<Id extends string> {
  private readonly _definitions = new Map<Id, UniverseCtor<Id>>();
  private readonly _instances = new Map<Id, UniverseBase<Id>>();
  private readonly _definitionOrder: Id[] = [];
  private _defaultId: Id | null = null;

  define(id: Id, ctor: UniverseCtor<Id>, isDefault: boolean): void {
    this._definitions.set(id, ctor);
    this._definitionOrder.push(id);
    if (isDefault && this._defaultId === null) this._defaultId = id;
  }

  /** Id to activate by default: the one marked default, or the first in definition order. */
  getDefaultId(): Id | undefined {
    if (this._defaultId !== null) return this._defaultId;
    return this._definitionOrder[0];
  }

  getOrCreate(id: Id): UniverseBase<Id> | undefined {
    let u = this._instances.get(id);
    if (u) return u;
    const ctor = this._definitions.get(id);
    if (!ctor) return undefined;
    u = ctor();
    this._instances.set(id, u);
    return u;
  }

  getInstance(id: Id): UniverseBase<Id> | undefined {
    return this._instances.get(id);
  }

  disposeAll(): void {
    for (const u of this._instances.values()) {
      u?.dispose();
    }
    this._instances.clear();
    this._definitions.clear();
    this._definitionOrder.length = 0;
    this._defaultId = null;
  }
}
