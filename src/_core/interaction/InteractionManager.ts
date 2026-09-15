import { EventMouse } from "@_core/helpers/event/Input.events.ts";
import {
  isInteractiveObject3DNode,
  type IInteractiveObject3DNode,
  type InteractivePointerContext,
} from "@_core/nodes/interactive/InteractiveObject3DNode.interface.ts";
import type INode from "@_core/nodes/Node.interface.ts";
import type Input from "@_core/systems/Input.ts";
import {
  Camera,
  Object3D,
  Raycaster,
  Vector2,
  type Intersection,
} from "three";

interface InteractionHit {
  node: IInteractiveObject3DNode;
  context: InteractivePointerContext;
}

export class InteractionManager {
  private readonly _input: Input;
  private readonly _raycaster = new Raycaster();
  private readonly _ndc = new Vector2();
  private readonly _nodes = new Set<IInteractiveObject3DNode>();
  private readonly _nodeObjects = new Map<IInteractiveObject3DNode, Object3D[]>();
  private readonly _objectOwners = new WeakMap<Object3D, IInteractiveObject3DNode>();
  private readonly _unsubscribers = new Set<() => void>();

  private _hovered: InteractionHit | null = null;
  private _downNode: IInteractiveObject3DNode | null = null;
  private _downContext: InteractivePointerContext | null = null;
  private _downSmoothContext: InteractivePointerContext | null = null;
  private _pendingMove = false;
  private _pendingDown = false;
  private _pendingUp = false;

  constructor(input: Input) {
    this._input = input;
    this._unsubscribers.add(
      this._input.subscribe(EventMouse.MOVE, () => {
        this._pendingMove = true;
      })
    );
    this._unsubscribers.add(
      this._input.subscribe(EventMouse.DOWN, () => {
        this._pendingDown = true;
      })
    );
    this._unsubscribers.add(
      this._input.subscribe(EventMouse.UP, () => {
        this._pendingUp = true;
      })
    );
  }

  register(node: INode): void {
    if (!isInteractiveObject3DNode(node)) return;
    this.unregister(node);

    const objects = node.getInteractiveObjects();
    if (objects.length === 0) return;

    this._nodes.add(node);
    this._nodeObjects.set(node, objects);
    for (const object of objects) {
      this._objectOwners.set(object, node);
    }
  }

  unregister(node: INode): void {
    if (!isInteractiveObject3DNode(node)) return;
    const objects = this._nodeObjects.get(node);
    if (objects) {
      for (const object of objects) {
        this._objectOwners.delete(object);
      }
    }
    this._nodeObjects.delete(node);
    this._nodes.delete(node);

    if (this._hovered?.node === node) {
      node.onPointerOut?.(this._hovered.context);
      this._hovered = null;
    }
    if (this._downNode === node) {
      this._downNode = null;
      this._downContext = null;
      this._downSmoothContext = null;
    }
  }

  update(cameraLike: unknown): void {
    if (this._downNode && this._input.mouse.buttons.left) {
      // Keep raycast updates alive while dragging, even if mousemove events are sparse.
      this._pendingMove = true;
    }

    if (!this._pendingMove && !this._pendingDown && !this._pendingUp) return;
    if (!(cameraLike instanceof Camera)) return;

    const rawHit = this._intersect(cameraLike, this._input.mouse.nx, this._input.mouse.ny);
    const smoothHit = this._intersect(
      cameraLike,
      this._input.smoothMouse.nx,
      this._input.smoothMouse.ny
    );
    this._syncHover(rawHit);

    if (this._pendingMove && rawHit) {
      rawHit.node.onPointerMove?.(rawHit.context);
    }
    if (this._pendingMove && smoothHit) {
      smoothHit.node.onPointerMoveSmooth?.(smoothHit.context);
    }

    if (this._pendingMove && this._downNode && this._input.mouse.buttons.left) {
      const capturedContext =
        rawHit?.node === this._downNode
          ? rawHit.context
          : this._downContext ?? this._hovered?.context ?? null;
      if (capturedContext) {
        this._downContext = capturedContext;
        this._downNode.onPointerMove?.(capturedContext);
      }

      const capturedSmoothContext =
        smoothHit?.node === this._downNode
          ? smoothHit.context
          : this._downSmoothContext ?? this._downContext ?? this._hovered?.context ?? null;
      if (capturedSmoothContext) {
        this._downSmoothContext = capturedSmoothContext;
        this._downNode.onPointerMoveSmooth?.(capturedSmoothContext);
      }
    }
    if (this._pendingDown) {
      this._downNode = rawHit?.node ?? smoothHit?.node ?? null;
      this._downContext = rawHit?.context ?? null;
      this._downSmoothContext = smoothHit?.context ?? null;

      if (rawHit) {
        rawHit.node.onPointerDown?.(rawHit.context);
      }
      if (smoothHit) {
        smoothHit.node.onPointerDownSmooth?.(smoothHit.context);
      }
    }
    if (this._pendingUp) {
      const upContext = rawHit?.context ?? this._downContext;
      const upSmoothContext = smoothHit?.context ?? this._downSmoothContext ?? this._downContext;
      if (this._downNode && upContext) {
        this._downNode.onPointerUp?.(upContext);
        if (rawHit && this._downNode === rawHit.node) {
          this._downNode.onClick?.(upContext);
        }
      }
      if (this._downNode && upSmoothContext) {
        this._downNode.onPointerUpSmooth?.(upSmoothContext);
      }
      this._downNode = null;
      this._downContext = null;
      this._downSmoothContext = null;
    }

    this._pendingMove = false;
    this._pendingDown = false;
    this._pendingUp = false;
  }

  dispose(): void {
    for (const unsubscribe of this._unsubscribers) {
      unsubscribe();
    }
    this._unsubscribers.clear();

    for (const node of this._nodes) {
      if (this._hovered?.node === node) {
        node.onPointerOut?.(this._hovered.context);
      }
    }
    this._nodes.clear();
    this._nodeObjects.clear();
    this._hovered = null;
    this._downNode = null;
    this._downContext = null;
    this._downSmoothContext = null;
    this._pendingMove = false;
    this._pendingDown = false;
    this._pendingUp = false;
  }

  private _syncHover(hit: InteractionHit | null): void {
    const prevNode = this._hovered?.node ?? null;
    const nextNode = hit?.node ?? null;
    if (prevNode === nextNode) {
      this._hovered = hit;
      return;
    }

    if (this._hovered) {
      this._hovered.node.onPointerOut?.(this._hovered.context);
    }
    if (hit) {
      hit.node.onPointerOver?.(hit.context);
    }
    this._hovered = hit;
  }

  private _intersect(camera: Camera, nx: number, ny: number): InteractionHit | null {
    const objects: Object3D[] = [];
    for (const node of this._nodes) {
      const nodeObjects = this._nodeObjects.get(node);
      if (!nodeObjects || nodeObjects.length === 0) continue;
      objects.push(...nodeObjects);
    }
    if (objects.length === 0) return null;

    this._ndc.set(nx, ny);
    this._raycaster.setFromCamera(this._ndc, camera);

    const intersections = this._raycaster.intersectObjects(objects, true);
    for (const intersection of intersections) {
      const node = this._resolveNode(intersection.object);
      if (!node) continue;
      return {
        node,
        context: {
          hitObject: intersection.object,
          intersection: intersection as Intersection<Object3D>,
        },
      };
    }

    return null;
  }

  private _resolveNode(object: Object3D): IInteractiveObject3DNode | null {
    let current: Object3D | null = object;
    while (current) {
      const owner = this._objectOwners.get(current);
      if (owner) return owner;
      current = current.parent;
    }
    return null;
  }
}
