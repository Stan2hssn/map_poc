import type INode from "@_core/nodes/Node.interface.ts";
import type { Object3D } from "three";

export interface IObject3DNode<Id extends string = string> extends INode {
  readonly id: Id;
  readonly name: string;
  readonly active: boolean;
  readonly mounted: boolean;

  getObject3D(): Object3D;
}
