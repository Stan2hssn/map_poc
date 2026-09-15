import type Input from "@_core/systems/Input.ts";
import type { Object3D } from "three";
import { Object3DNodeBase } from "../object3d/Object3DNode.base.ts";
import type {
  IInteractiveObject3DNode,
  InteractivePointerContext,
} from "./InteractiveObject3DNode.interface.ts";

export abstract class InteractiveObject3DNodeBase
  extends Object3DNodeBase
  implements IInteractiveObject3DNode
{
  constructor(
    id: string,
    name: string,
    object3D: Object3D,
    input: Input | null = null
  ) {
    super(id, name, object3D, input);
  }

  getInteractiveObjects(): Object3D[] {
    return [this.getObject3D()];
  }

  onPointerOver(_context: InteractivePointerContext): void {
    //
  }

  onPointerOut(_context: InteractivePointerContext | null): void {
    //
  }

  onPointerMove(_context: InteractivePointerContext): void {
    //
  }

  onPointerMoveSmooth(_context: InteractivePointerContext): void {
    //
  }

  onPointerDown(_context: InteractivePointerContext): void {
    //
  }

  onPointerDownSmooth(_context: InteractivePointerContext): void {
    //
  }

  onPointerUp(_context: InteractivePointerContext): void {
    //
  }

  onPointerUpSmooth(_context: InteractivePointerContext): void {
    //
  }

  onClick(_context: InteractivePointerContext): void {
    //
  }
}
