import { Object3DNodeBase } from "@_core/nodes/object3d/Object3DNode.base.ts";
import { NODE_ID } from "@graphics/nodes/Node.id.ts";
import { BoxGeometry, Mesh, MeshNormalMaterial } from "three";

/**
 * Contrat de base du projet : la preuve que device, univers, contrat, graphe et
 * sortie tournent de bout en bout. A remplacer par la carte.
 *
 * `MeshNormalMaterial` et non `MeshBasicMaterial` : aplat sans lumiere, une
 * rotation ne se verrait qu'a la silhouette.
 */
export class CubeNode extends Object3DNodeBase {
  private readonly _mesh: Mesh;
  private readonly _geometry: BoxGeometry;
  private readonly _material: MeshNormalMaterial;

  /** rad/s. Objet et non champ : `debug.bind` ecrit dans une cle. */
  readonly spin = { x: 0.4, y: 0.7 };

  constructor() {
    const geometry = new BoxGeometry(1, 1, 1);
    const material = new MeshNormalMaterial();
    const mesh = new Mesh(geometry, material);
    super(NODE_ID.CUBE, "Cube", mesh);

    this._geometry = geometry;
    this._material = material;
    this._mesh = mesh;
  }

  // `dt` est en millisecondes (`FrameTiming`).
  override update(_time: number, dt: number): void {
    const seconds = dt / 1000;
    this._mesh.rotation.x += this.spin.x * seconds;
    this._mesh.rotation.y += this.spin.y * seconds;
  }

  override dispose(): void {
    this._geometry.dispose();
    this._material.dispose();
    super.dispose();
  }
}
