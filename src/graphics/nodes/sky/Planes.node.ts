import { Object3DNodeBase } from "@_core/nodes/object3d/Object3DNode.base.ts";
import { terrainSettings } from "@graphics/materials/Terrain.material.ts";
import { NODE_ID } from "@graphics/nodes/Node.id.ts";
import type { TerrainNode } from "@graphics/nodes/terrain/Terrain.node.ts";
import { BoxGeometry, Group, InstancedMesh, MathUtils, Matrix4, Quaternion, Vector3, type BufferGeometry } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { drawnMask } from "@graphics/materials/Terrain.material.ts";
import { float, mix, mrt, directionToColor, normalView, output, positionWorld, vec3, vec4 } from "three/tsl";
import { MeshStandardNodeMaterial } from "three/webgpu";

/** Avion ou ombre : efface hors de la zone dessinee, comme le reste de la carte. */
function skyMaterial(color: number, roughness: number): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial({ color, roughness, metalness: 0 });
  const shown = mix(float(1), drawnMask(positionWorld.xz), terrainSettings.pen);
  material.outputNode = vec4(mix(vec3(terrainSettings.pen), output.rgb, shown), output.a);
  material.mrtNode = mrt({ normal: vec4(directionToColor(normalView), shown) });
  return material;
}

/** Avions a la fois, au plus. */
const COUNT = 4;
/**
 * Vol : altitude au-dessus du plus haut relief de la vue (unites de scene), cercle traverse (en profondeurs de la
 * zone dessinee), duree d'une traversee (s), longueur d'un avion (unites : un symbole de carte plus qu'une
 * maquette), attente entre deux passages (s), largeurs de vue entre lesquelles ils s'effacent (km : a l'echelle
 * d'un pays, un avion de la taille d'une ville n'a aucun sens). Altitude, longueur et duree valent pour une vue
 * large de `refKm` : ailleurs, elles suivent l'echelle de la carte.
 */
const SKY = { above: 7, reach: 1.2, crossSeconds: 26, length: 3.2, wait: [2, 9], fromKm: 25, toKm: 70, refKm: 12, maxSize: 2 } as const;
const COLOR = 0x2b3144;
/** Ombre au sol : teinte, et ecart au relief (unites). */
const SHADOW = { color: 0x9a9a9a, lift: 0.05 } as const;
const UP = new Vector3(0, 1, 0);
const TURN = new Quaternion();
const SCALE = new Vector3();
const AT = new Vector3();

interface Plane {
  position: Vector3;
  heading: number;
  /** Secondes avant de reparaitre ; 0 : en vol. */
  wait: number;
}

/** Avion en boites : fuselage le long de x, ailes, empennage. */
function planeGeometry(): BufferGeometry {
  const box = (length: number, height: number, width: number, x: number, y = 0) =>
    new BoxGeometry(length, height, width).translate(x, y, 0);
  const parts = [box(1, 0.14, 0.14, 0), box(0.22, 0.03, 1, 0.05), box(0.12, 0.03, 0.38, -0.42), box(0.14, 0.2, 0.03, -0.44, 0.1)];
  const plane = mergeGeometries(parts)!;
  for (const part of parts) part.dispose();
  return plane.scale(SKY.length, SKY.length, SKY.length);
}

/**
 * Avions, peu nombreux : chacun traverse la zone dessinee en ligne droite, au-dessus du relief, puis un autre passe
 * un peu plus tard, d'ailleurs ; son ombre glisse sur le sol, ce qui dit sa hauteur. Ils volent au-dessus de la
 * carte, a son echelle : un glisser les emporte avec elle, un zoom les grandit ou les rapetisse avec elle.
 * A l'encre comme le reste.
 */
export class PlanesNode extends Object3DNodeBase {
  /** Part des avions montres (0 : aucun). */
  readonly settings = { density: 0.5 };
  /** Un avion vole : l'image n'est jamais tout a fait immobile. */
  lively = false;
  private readonly _terrain: TerrainNode;
  private readonly _mesh: InstancedMesh;
  private readonly _shadows: InstancedMesh;
  private readonly _planes: Plane[];
  private readonly _matrix = new Matrix4();
  private _anchor: { lon: number; lat: number } | null = null;
  private _extent = 0;

  constructor(terrain: TerrainNode) {
    const group = new Group();
    super(NODE_ID.PLANES, "Planes", group);
    this._terrain = terrain;
    const geometry = planeGeometry();
    this._mesh = new InstancedMesh(geometry, skyMaterial(COLOR, 0.6), COUNT);
    this._shadows = new InstancedMesh(geometry, skyMaterial(SHADOW.color, 1), COUNT);
    for (const mesh of [this._mesh, this._shadows]) mesh.frustumCulled = false;
    group.add(this._mesh, this._shadows);
    this._planes = Array.from({ length: COUNT }, (_, i) => ({ position: new Vector3(), heading: 0, wait: i * 4 + 0.5 }));
  }

  override update(_time: number, dt: number): void {
    const seconds = Math.min(dt, 100) / 1000;
    const t = this._terrain;
    const s = terrainSettings;
    const reach = s.maskRadius.value.y * s.maskScale.value * SKY.reach;
    // Ils volent dans l'espace de la carte, pas dans celui de l'ecran : au dezoom, ils rapetissent avec elle
    // au lieu de garder leur taille pendant que tout le reste diminue. Borne en zoom avant : la camera ne
    // s'eloigne pas avec l'echelle, un avion trop grand volerait a sa hauteur.
    const size = Math.min(SKY.maxSize, SKY.refKm / Math.max(1e-3, t.extentKm));
    const altitude = s.relief.value * t.heightScale + SKY.above * size;
    const sun = s.sun.value;
    // La carte glisse ou change d'echelle sous eux : ils suivent le sol.
    const zoom = this._extent > 0 ? this._extent / t.extentKm : 1;
    const shift = this._anchor ? t.sceneOf(this._anchor.lon, this._anchor.lat) : { x: 0, z: 0 };
    this._anchor = { ...t.center };
    this._extent = t.extentKm;
    this.lively = false;
    const wide = 1 - MathUtils.clamp((t.extentKm - SKY.fromKm) / (SKY.toKm - SKY.fromKm), 0, 1);
    const shown = Math.round(COUNT * this.settings.density * wide);
    this._planes.forEach((plane, i) => {
      if (i >= shown) {
        this._mesh.setMatrixAt(i, this._matrix.compose(plane.position, TURN, SCALE.setScalar(0)));
        this._shadows.setMatrixAt(i, this._matrix.compose(plane.position, TURN, SCALE.setScalar(0)));
        return;
      }
      const { position } = plane;
      position.x = position.x * zoom + shift.x;
      position.z = position.z * zoom + shift.z;
      if (plane.wait > 0) {
        plane.wait -= seconds;
        if (plane.wait <= 0) this._launch(plane, reach);
      } else {
        const speed = ((reach * 2) / SKY.crossSeconds) * size;
        position.x += Math.cos(plane.heading) * speed * seconds;
        position.z -= Math.sin(plane.heading) * speed * seconds;
        if (Math.hypot(position.x, position.z) > reach * 1.05) plane.wait = SKY.wait[0] + Math.random() * (SKY.wait[1] - SKY.wait[0]);
      }
      position.y = altitude;
      const flying = plane.wait <= 0;
      this.lively ||= flying;
      TURN.setFromAxisAngle(UP, plane.heading);
      this._mesh.setMatrixAt(i, this._matrix.compose(position, TURN, SCALE.setScalar(flying ? size : 0)));
      // Ombre : le long du soleil jusqu'au sol, aplatie.
      const ground = t.heightAt(position.x, position.z);
      const along = sun.y > 0.05 ? (altitude - ground) / sun.y : 0;
      AT.set(position.x - sun.x * along, 0, position.z - sun.z * along);
      AT.y = t.heightAt(AT.x, AT.z) + SHADOW.lift;
      this._shadows.setMatrixAt(i, this._matrix.compose(AT, TURN, SCALE.set(flying ? size : 0, 0.02, flying ? size : 0)));
    });
    this._mesh.instanceMatrix.needsUpdate = true;
    this._shadows.instanceMatrix.needsUpdate = true;
  }

  override dispose(): void {
    this._mesh.geometry.dispose();
    for (const mesh of [this._mesh, this._shadows]) (mesh.material as MeshStandardNodeMaterial).dispose();
    super.dispose();
  }

  /** Entre au bord du cercle, vers l'autre cote a peu pres. */
  private _launch(plane: Plane, reach: number): void {
    const from = Math.random() * Math.PI * 2;
    plane.position.set(Math.cos(from) * reach, 0, -Math.sin(from) * reach);
    plane.heading = from + Math.PI + (Math.random() - 0.5) * 0.7;
  }
}
