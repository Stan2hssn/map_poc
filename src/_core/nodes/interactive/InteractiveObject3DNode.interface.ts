import type { Intersection, Object3D } from "three";
import type { IObject3DNode } from "../object3d/Object3DNode.interface.ts";

export interface InteractivePointerContext {
  hitObject: Object3D;
  intersection: Intersection<Object3D>;
}

export interface IInteractiveObject3DNode extends IObject3DNode {
  getInteractiveObjects(): Object3D[];
  onPointerOver?(context: InteractivePointerContext): void;
  onPointerOut?(context: InteractivePointerContext | null): void;
  onPointerMove?(context: InteractivePointerContext): void;
  onPointerMoveSmooth?(context: InteractivePointerContext): void;
  onPointerDown?(context: InteractivePointerContext): void;
  onPointerDownSmooth?(context: InteractivePointerContext): void;
  onPointerUp?(context: InteractivePointerContext): void;
  onPointerUpSmooth?(context: InteractivePointerContext): void;
  onClick?(context: InteractivePointerContext): void;
}

export function isInteractiveObject3DNode(node: unknown): node is IInteractiveObject3DNode {
  return (
    typeof node === "object" &&
    node !== null &&
    typeof (node as IInteractiveObject3DNode).getInteractiveObjects === "function"
  );
}
