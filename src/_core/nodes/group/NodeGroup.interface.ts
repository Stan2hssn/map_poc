import type INode from "@_core/nodes/Node.interface.ts";
import type { NodeGraph } from "@_core/nodes/NodeGraph.ts";
import type { IGroupNode } from "./GroupNode.interface.ts";

export interface INodeGroup<
  Id extends string = string,
  ItemId extends string = string,
> extends IGroupNode<Id, ItemId> {
  getNodes(): INode[];
  register(graph: NodeGraph): void;
  subscribe(eventType: string, handler: (payload?: unknown) => void): () => void;
  dispatch(eventType: string, payload?: unknown): void;
  beforeMount?(): void | Promise<void>;
  onMounted?(): void;
  beforeUnmount?(): void | Promise<void>;
  onUnmounted?(): void;
  dispose?(): void;
}
