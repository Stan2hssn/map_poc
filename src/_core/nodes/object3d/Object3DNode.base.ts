import type Input from "@_core/systems/Input.ts";
import type { Object3D } from "three";
import { NodeBase } from "../Node.base.ts";
import type { IObject3DNode } from "./Object3DNode.interface.ts";

export abstract class Object3DNodeBase extends NodeBase implements IObject3DNode {
  protected readonly _object3D: Object3D;

  constructor(
    id: string,
    name: string,
    object3D: Object3D,
    input: Input | null = null
  ) {
    super(id, name, input);
    this._object3D = object3D;
  }

  getObject3D(): Object3D {
    return this._object3D;
  }
}
