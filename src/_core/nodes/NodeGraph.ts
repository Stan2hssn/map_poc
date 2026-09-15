// NodeGraph.ts
import type { Scene } from 'three';
import type INode from './Node.interface';
import type { IObject3DNode } from './object3d/Object3DNode.interface';

function isObject3DNode(node: INode): node is IObject3DNode {
  return typeof (node as IObject3DNode).getObject3D === 'function';
}

export class NodeGraph {
  private readonly nodes = new Map<string, INode>();
  private readonly mounted = new Set<string>();
  private readonly _mountObservers = new Set<(node: INode) => void>();
  private readonly _unmountObservers = new Set<(node: INode) => void>();

  private readonly scene: Scene;

  constructor(_scene: Scene) {
    this.scene = _scene;
  }

  addMany(nodes: INode[]) {
    for (const node of nodes) {
      this.add(node);
    }
  }

  add(node: INode) {
    this.nodes.set(node.id, node);
  }

  get(id: string): INode | undefined {
    return this.nodes.get(id);
  }


  getMany(ids: string[]): INode[] {
    return ids.map((id) => this.nodes.get(id)).filter((node): node is INode => node !== undefined);
  }

  has(id: string): boolean {
    return this.nodes.has(id);
  }

  isMounted(id: string): boolean {
    return this.mounted.has(id);
  }

  addMountObserver(handler: (node: INode) => void): () => void {
    this._mountObservers.add(handler);
    return () => {
      this._mountObservers.delete(handler);
    };
  }

  addUnmountObserver(handler: (node: INode) => void): () => void {
    this._unmountObservers.add(handler);
    return () => {
      this._unmountObservers.delete(handler);
    };
  }

  /** Mount = setup -> attach scene (if Object3D) -> onMounted (can start entry anim). */
  async mount(id: string): Promise<void> {
    if (this.mounted.has(id)) return;

    const node = this.nodes.get(id);
    if (!node) throw new Error(`[NodeGraph] mount(): node "${id}" not found`);

    // Setup (no animation here by convention)
    await node.beforeMount?.();

    // Structural attach
    if (isObject3DNode(node)) {
      this.scene.add(node.getObject3D());
    }

    // Entry (fire-and-forget)
    node.onMounted?.();

    this.mounted.add(id);
    for (const handler of this._mountObservers) {
      handler(node);
    }
  }

  /** Unmount = await beforeUnmount (exit anim) -> detach scene -> onUnmounted cleanup. */
  async unmount(id: string): Promise<void> {
    if (!this.mounted.has(id)) return;

    const node = this.nodes.get(id);
    if (!node) throw new Error(`[NodeGraph] unmount(): node "${id}" not found`);

    // Exit animation allowed here (awaited)
    await node.beforeUnmount?.();

    // Structural detach
    if (isObject3DNode(node)) {
      this.scene.remove(node.getObject3D());
    }

    node.onUnmounted?.();

    for (const handler of this._unmountObservers) {
      handler(node);
    }

    this.mounted.delete(id);
  }

  /** Mount many in parallel */
  async mountMany(ids: string[]): Promise<void> {
    await Promise.all(ids.map((id) => this.mount(id)));
  }

  /** Unmount many in parallel */
  async unmountMany(ids: string[]): Promise<void> {
    await Promise.all(ids.map((id) => this.unmount(id)));
  }

  update(time: number, dt: number) {
    for (const id of this.mounted) {
      const node = this.nodes.get(id);
      node?.update?.(time, dt);
    }
  }

  resize(width: number, height: number) {
    for (const node of this.nodes.values()) {
      node.resize?.(width, height);
    }
  }

  dispose() {
    for (const node of this.nodes.values()) {
      node.dispose?.();
    }
    this.nodes.clear();
    this.mounted.clear();
    this._mountObservers.clear();
    this._unmountObservers.clear();
  }
}
