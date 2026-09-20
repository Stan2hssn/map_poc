import { Object3DNodeBase } from "@_core/nodes/object3d/Object3DNode.base.ts";
import { terrainSettings } from "@graphics/materials/Terrain.material.ts";
import { NODE_ID } from "@graphics/nodes/Node.id.ts";
import type { TerrainNode } from "@graphics/nodes/terrain/Terrain.node.ts";
import { CLOUDS_COUNT, CLOUDS_WORLD, inkSettings, onCloudsDrawn } from "@graphics/postprocessing/index.ts";
import { InstancedBufferAttribute, InstancedMesh, Matrix4, PlaneGeometry, Quaternion, Vector3, type Camera } from "three";
import { directionToColor, float, instancedBufferAttribute, mrt, normalView, texture, uv, vec2, vec4 } from "three/tsl";
import { MeshBasicNodeMaterial } from "three/webgpu";

/** Nuages a la fois, au plus (l'utilisateur en regle la part). */
const COUNT = 12;
/**
 * Ciel : hauteur au-dessus du plus haut relief de la vue (unites de scene), angles sous l'horizon ou les nuages
 * se tiennent (degres : la bande de ciel juste au-dessus de la zone dessinee), distances au point vise (en
 * profondeurs de la zone dessinee), vent (unites/s), tailles (fraction de celle dessinee dans la texture).
 */
const SKY = { base: 4, below: [12.5, 17], near: 1.1, far: 1.8, wind: 0.7, size: [0.5, 1], spread: 45, keep: 75 } as const;
/** Un nuage de la texture, en unites de scene. */
const CLOUD = [CLOUDS_WORLD[0] / CLOUDS_COUNT, CLOUDS_WORLD[1]] as const;
/** Ecart d'angle (radians) ramene entre -PI et PI. */
const angleTo = (angle: number, from: number): number => {
  const gap = (angle - from + Math.PI * 3) % (Math.PI * 2);
  return gap - Math.PI;
};
const TURN = new Quaternion();
const UP = new Vector3(0, 1, 0);
const SCALE = new Vector3();

interface Cloud {
  /** Position dans la scene (le y est refait a chaque image : le relief bouge). */
  at: Vector3;
  size: number;
  /** Place dans la bande de ciel, de 0 (pres de l'horizon) a 1 (plus bas, plus pres de la carte). */
  lift: number;
}

/**
 * Nuages poses dans le ciel, chacun a sa place : des tableaux dessines (une case de la texture des nuages par
 * nuage) tournes vers la camera, autour du point vise et au-dessus du relief, portes par un vent lent. Rien ne se
 * repete a intervalle regulier : chacun part d'ou il veut et reparait ailleurs en sortant de la vue. Ils suivent
 * la carte quand elle glisse ou change d'echelle.
 */
export class CloudsNode extends Object3DNodeBase {
  /** Part des nuages montres. */
  readonly settings = { density: 0.6 };
  private readonly _terrain: TerrainNode;
  private readonly _camera: () => Camera;
  private readonly _mesh: InstancedMesh;
  private readonly _cells: InstancedBufferAttribute;
  private readonly _clouds: Cloud[];
  private readonly _matrix = new Matrix4();
  private _anchor: { lon: number; lat: number } | null = null;
  private _extent = 0;
  private _seed = 3;

  constructor(terrain: TerrainNode, camera: () => Camera) {
    const material = new MeshBasicNodeMaterial({ alphaTest: 0.45 });
    // Une case de la texture par nuage. A l'encre : un ton gris serait rendu au papier par la passe de dessin
    // (elle n'encre que les tons sombres) ; le reglage ne change donc pas la teinte mais le nombre de traits gardes.
    const cells = new InstancedBufferAttribute(new Float32Array(COUNT), 1);
    const at = vec2(uv().x.add(instancedBufferAttribute(cells)).div(CLOUDS_COUNT), uv().y.oneMinus());
    material.colorNode = inkSettings.ink;
    material.opacityNode = float(0);
    onCloudsDrawn((map) => {
      material.opacityNode = texture(map).sample(at).r.mul(inkSettings.clouds.add(0.5));
      material.needsUpdate = true;
    });
    // Dessine comme le bati : alpha negative, donc pas de contour de profondeur autour du tableau.
    material.mrtNode = mrt({ normal: vec4(directionToColor(normalView), -1) });
    const geometry = new PlaneGeometry(CLOUD[0], CLOUD[1]);
    const mesh = new InstancedMesh(geometry, material, COUNT);
    super(NODE_ID.CLOUDS, "Clouds", mesh);
    this._terrain = terrain;
    this._camera = camera;
    this._mesh = mesh;
    this._cells = cells;
    mesh.frustumCulled = false;
    this._clouds = Array.from({ length: COUNT }, () => ({ at: new Vector3(), size: 1, lift: 0 }));
    this._clouds.forEach((cloud, i) => this._place(cloud, i, 120, -Math.PI / 2));
  }

  override update(_time: number, dt: number): void {
    const t = this._terrain;
    const s = terrainSettings;
    const reach = s.maskRadius.value.y * s.maskScale.value;
    const altitude = s.relief.value * t.heightScale + SKY.base;
    const eye = this._camera().position;
    // La carte glisse ou change d'echelle sous eux.
    const zoom = this._extent > 0 ? this._extent / t.extentKm : 1;
    const shift = this._anchor ? t.sceneOf(this._anchor.lon, this._anchor.lat) : { x: 0, z: 0 };
    this._anchor = { ...t.center };
    this._extent = t.extentKm;
    const wind = (SKY.wind * Math.min(dt, 100)) / 1000;
    // Devant la camera : le tour complet demanderait des dizaines de nuages pour en voir deux.
    const look = Math.atan2(s.maskAxis.value.y, s.maskAxis.value.x);
    const shown = Math.round(COUNT * this.settings.density);
    this._clouds.forEach((cloud, i) => {
      const { at } = cloud;
      at.x = at.x * zoom + shift.x + wind;
      at.z = at.z * zoom + shift.z;
      const distance = Math.hypot(at.x, at.z);
      // Sorti de la couronne, ou passe derriere (la vue a tourne) : il repart devant, ailleurs.
      const away = Math.abs(angleTo(Math.atan2(at.z, at.x), look));
      const gone = distance > reach * (SKY.far + 0.4) || distance < reach * (SKY.near - 0.35) || away > (SKY.keep * Math.PI) / 180;
      if (gone) this._place(cloud, i, reach, look);
      // Poses dans la bande de ciel qu'on voit au-dessus de la carte : sous l'horizon de quelques degres, donc
      // d'autant plus bas qu'ils sont loin. Jamais dans le relief.
      const below = SKY.below[0] + cloud.lift * (SKY.below[1] - SKY.below[0]);
      at.y = Math.max(altitude, eye.y - Math.hypot(at.x - eye.x, at.z - eye.z) * Math.tan((below * Math.PI) / 180));
      // Face a la camera, debout : un tableau qu'on regarde toujours de face.
      TURN.setFromAxisAngle(UP, Math.atan2(eye.x - at.x, eye.z - at.z));
      this._mesh.setMatrixAt(i, this._matrix.compose(at, TURN, SCALE.setScalar(i < shown ? cloud.size : 0)));
    });
    this._mesh.instanceMatrix.needsUpdate = true;
  }

  override dispose(): void {
    this._mesh.geometry.dispose();
    (this._mesh.material as MeshBasicNodeMaterial).dispose();
    super.dispose();
  }

  /** Repose un nuage au hasard devant la camera, dans la couronne autour du point vise. */
  private _place(cloud: Cloud, index: number, reach: number, look: number): void {
    const random = () => (this._seed = (this._seed * 16807) % 2147483647) / 2147483647;
    const angle = look + ((random() * 2 - 1) * SKY.spread * Math.PI) / 180;
    const distance = reach * (SKY.near + random() * (SKY.far - SKY.near));
    cloud.at.set(Math.cos(angle) * distance, 0, Math.sin(angle) * distance);
    cloud.size = SKY.size[0] + random() * (SKY.size[1] - SKY.size[0]);
    cloud.lift = random();
    this._cells.setX(index, Math.floor(random() * CLOUDS_COUNT));
    this._cells.needsUpdate = true;
  }
}
