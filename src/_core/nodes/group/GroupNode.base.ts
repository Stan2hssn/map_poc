import type { IGroupNode } from "./GroupNode.interface.ts";

export class GroupNodeBase<
  Id extends string = string,
  ItemId extends string = string,
> implements IGroupNode<Id, ItemId>
{
  readonly id: Id;
  private readonly _itemIds = new Set<ItemId>();

  constructor(id: Id, itemIds: ItemId[] = []) {
    this.id = id;
    this.include(...itemIds);
  }

  include(...itemIds: ItemId[]): this {
    for (const itemId of itemIds) this._itemIds.add(itemId);
    return this;
  }

  exclude(...itemIds: ItemId[]): this {
    for (const itemId of itemIds) this._itemIds.delete(itemId);
    return this;
  }

  clear(): this {
    this._itemIds.clear();
    return this;
  }

  set(itemIds: ItemId[]): this {
    this.clear();
    this.include(...itemIds);
    return this;
  }

  has(itemId: ItemId): boolean {
    return this._itemIds.has(itemId);
  }

  getItemIds(): ItemId[] {
    return Array.from(this._itemIds);
  }
}
