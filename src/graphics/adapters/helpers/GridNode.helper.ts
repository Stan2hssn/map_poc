import { Object3DNodeBase } from "@/_core/nodes/object3d/Object3DNode.base";
import { getGsap } from "@/plugins/gsap";
import { NODE_ID } from "@graphics/nodes/Node.id.ts";
import {
  GridHelper,
  type Material,
  Object3D,
  Quaternion,
  Vector3,
} from "three";

interface GridNodeOptions {
  object?: Object3D | null;
  size?: number;
  divisions?: number;
  opacity?: number;
  followAttachedObject?: boolean;
}

export class GridNode extends Object3DNodeBase {
  private readonly _grid: GridHelper;
  private readonly _targetOpacity: number;
  private readonly _followAttachedObject: boolean;
  private readonly _worldPosition = new Vector3();
  private readonly _opacityState = { value: 0 };
  private _attachedObject: Object3D | null = null;

  constructor(options: GridNodeOptions = {}) {
    const size = options.size ?? 20;
    const divisions = options.divisions ?? 20;
    const grid = new GridHelper(size, divisions, 0xffffff, 0x888888);
    super(NODE_ID.GRID_NODE, "Grid Node", grid);

    this._targetOpacity = options.opacity ?? 0.35;
    this._followAttachedObject = options.followAttachedObject ?? true;
    this._grid = grid;
    this._grid.position.set(0, 0, 0);
    this._setOpacity(0);

    this.attach(options.object ?? null);
  }

  attach(object: Object3D | null): void {
    this._attachedObject = object;
  }

  detach(): void {
    this._attachedObject = null;
  }

  get attachedObject(): Object3D | null {
    return this._attachedObject;
  }

  getAttachedWorldPosition(target = new Vector3()): Vector3 {
    if (!this._attachedObject) return target.set(0, 0, 0);
    return this._attachedObject.getWorldPosition(target);
  }

  getAttachedWorldQuaternion(target = new Quaternion()): Quaternion {
    if (!this._attachedObject) return target.identity();
    return this._attachedObject.getWorldQuaternion(target);
  }

  beforeMount(): void {
    this._opacityState.value = 0;
    this._setOpacity(this._opacityState.value);
  }

  onMounted(): void {
    super.onMounted();
    getGsap().then((gsap) => {
      gsap.killTweensOf(this._opacityState);
      gsap.to(this._opacityState, {
        value: this._targetOpacity,
        duration: 0.45,
        ease: "power2.out",
        onUpdate: () => this._setOpacity(this._opacityState.value),
      });
    });
  }

  beforeUnmount(): Promise<void> {
    return getGsap().then((gsap) => {
      gsap.killTweensOf(this._opacityState);
      return new Promise<void>((resolve) => {
        gsap.to(this._opacityState, {
          value: 0,
          duration: 0.35,
          ease: "power2.in",
          onUpdate: () => this._setOpacity(this._opacityState.value),
          onComplete: () => resolve(),
        });
      });
    });
  }

  onUnmounted(): void {
    super.onUnmounted();
  }

  update(_time: number, _dt: number): void {
    if (!this._followAttachedObject || !this._attachedObject) return;
    const worldPosition = this.getAttachedWorldPosition(this._worldPosition);
    this._grid.position.set(worldPosition.x, worldPosition.y, worldPosition.z);
  }

  dispose(): void {
    this._grid.geometry.dispose();
    const mat = this._grid.material;
    if (Array.isArray(mat)) {
      for (const m of mat) m.dispose();
      return;
    }
    (mat as Material).dispose();
  }

  private _setOpacity(value: number): void {
    const mat = this._grid.material;
    if (Array.isArray(mat)) {
      for (const m of mat) {
        m.transparent = true;
        m.opacity = value;
        m.depthWrite = false;
      }
      return;
    }

    mat.transparent = true;
    mat.opacity = value;
    mat.depthWrite = false;
  }
}
