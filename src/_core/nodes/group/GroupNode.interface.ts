export interface IGroupNode<Id extends string = string, ItemId extends string = string> {
  readonly id: Id;
  getItemIds(): ItemId[];
  has(itemId: ItemId): boolean;
}
