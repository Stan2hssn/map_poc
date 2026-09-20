import { Object3DNodeBase } from "@_core/nodes/object3d/Object3DNode.base.ts";
import { TERRAIN_CONFIG } from "@graphics/config/terrain.config.ts";
import { groundFade, terrainHeight, terrainSettings } from "@graphics/materials/Terrain.material.ts";
import { NODE_ID } from "@graphics/nodes/Node.id.ts";
import type { TerrainNode } from "@graphics/nodes/terrain/Terrain.node.ts";
import { expandBounds } from "@graphics/terrain/GeoProjection.ts";
import { formatDegrees, graticuleStep, graticuleValues } from "@graphics/terrain/Graticule.ts";
import {
  BufferAttribute,
  BufferGeometry,
  Group,
  InstancedBufferAttribute,
  LineSegments,
  Sprite,
  Vector2,
  Vector3,
  type Camera,
} from "three";
import {
  cameraPosition,
  cameraViewMatrix,
  color,
  float,
  instancedBufferAttribute,
  length,
  mix,
  mod,
  positionGeometry,
  sin,
  smoothstep,
  step,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { LineBasicNodeMaterial, PointsNodeMaterial } from "three/webgpu";

/** Au plus autant de meridiens sur la largeur de la zone de detail ; le sol en porte `groundSpan` fois plus. */
const MAX_LINES = 6;
const SPAN = TERRAIN_CONFIG.groundSpan;
/** Uv du sol : de `GROUND_MIN` a `GROUND_MIN + SPAN`. */
const GROUND_MIN = 0.5 - SPAN / 2;
/** Points par ligne drapee, et hauteur au-dessus du sol. */
const SAMPLES = 360;
const LIFT = 0.15;
/**
 * Poussiere : grains au plus, demi-cote du cube autour de la camera et distance sous laquelle ils s'effacent
 * (unites de scene), vent (unites par seconde), taille au plus pres (px).
 */
const DUST = 6000;
const DUST_BOX = 24;
const DUST_NEAR = 2;
const DUST_WIND = 0.6;
const DUST_SIZE = 14;
const LABEL_OFFSET_PX = 14;

interface SurveyText {
  root: HTMLElement;
  u: number;
  v: number;
  side: "north" | "west";
}

// Traces au sol, sombres et en transparence sur le relief clair.
const onGround = { transparent: true, depthWrite: false } as const;
const INK = 0x1c1c1c;

function lineGeometry(): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(0), 3));
  return geometry;
}

/**
 * Releves, facon generique de film : graticule drapee sur le relief, points aux croisements, poussiere en
 * suspension, coordonnees espacees.
 */
export class SurveyNode extends Object3DNodeBase {
  private readonly _terrain: TerrainNode;
  private readonly _canvas: HTMLElement;
  private readonly _camera: () => Camera;
  private readonly _blockSpace = new Group();
  private readonly _draped = new LineSegments(lineGeometry(), new LineBasicNodeMaterial(onGround));
  private readonly _crossings = new InstancedBufferAttribute(new Float32Array(((MAX_LINES + 1) * SPAN + 1) ** 2 * 3), 3);
  private readonly _dots: Sprite;
  private readonly _dust: Sprite;
  private readonly _clock = uniform(0);
  private readonly _drift = uniform(new Vector2());
  private readonly _point = new Vector3();
  /** Poussiere : part des grains montres, et taille (fraction de `DUST_SIZE`). */
  readonly settings = { dustDensity: 0.2, dustSize: 1 };
  private readonly _dustSize = uniform(1);
  private _texts: SurveyText[] = [];
  private _layer: HTMLElement | null = null;
  private _version = -1;
  private _anchor: { lon: number; lat: number } | null = null;

  constructor(terrain: TerrainNode, canvas: HTMLElement, camera: () => Camera) {
    const group = new Group();
    super(NODE_ID.SURVEY, "Survey", group);
    this._terrain = terrain;
    this._canvas = canvas;
    this._camera = camera;
    this._dots = this._createDots();
    this._dust = this._createDust();
    this._setupLines();
    this._blockSpace.add(this._draped);
    group.add(this._blockSpace, this._dots, this._dust);
    for (const object of [this._draped, this._dots, this._dust]) object.frustumCulled = false;
  }

  override onMounted(): void {
    super.onMounted();
    this._layer = document.createElement("div");
    this._layer.className = "map-survey";
    this._canvas.parentElement?.append(this._layer);
  }

  override onUnmounted(): void {
    this._layer?.remove();
    this._layer = null;
    this._texts = [];
    this._version = -1;
    super.onUnmounted();
  }

  override update(_time: number, dt: number): void {
    const terrain = this._terrain;
    this._blockSpace.position.copy(terrain.block.position);
    this._blockSpace.scale.copy(terrain.block.scale);
    this._clock.value += dt / 1000;
    this._followGround();
    this._dust.count = Math.round(DUST * this.settings.dustDensity);
    this._dustSize.value = this.settings.dustSize;
    if (terrain.viewVersion !== this._version) {
      this._version = terrain.viewVersion;
      this._rebuild();
    }
    this._layoutTexts();
  }

  override dispose(): void {
    this._layer?.remove();
    this._draped.geometry.dispose();
    for (const object of [this._draped, this._dots, this._dust]) (object.material as { dispose(): void }).dispose();
    super.dispose();
  }

  private _setupLines(): void {
    // x, z sont les uv du bloc ; elles s'effacent avec le sol.
    const draped = this._draped.material as LineBasicNodeMaterial;
    const blockUv = positionGeometry.xz;
    draped.positionNode = vec3(blockUv.x, terrainHeight(blockUv).add(LIFT), blockUv.y);
    draped.colorNode = color(INK);
    draped.opacityNode = groundFade(blockUv).mul(0.55);
  }

  /**
   * Croisements drapes : un point, et un anneau pour le plus central. Decoupes net (`alphaTest`) : en transparence,
   * leur carre entier passait dans les normales, et l'encre en tracait le contour.
   */
  private _createDots(): Sprite {
    const material = new PointsNodeMaterial({ sizeAttenuation: false, alphaTest: 0.5 });
    const crossing = instancedBufferAttribute(this._crossings);
    const block = terrainSettings.blockSize;
    const at = crossing.xy;
    material.positionNode = vec3(at.x.sub(0.5).mul(block.x), terrainHeight(at).add(LIFT * 2), at.y.sub(0.5).mul(block.y));
    const ring = crossing.z;
    material.sizeNode = mix(float(5), float(22), ring).mul(groundFade(at));
    const r = length(uv().sub(0.5));
    const dot = smoothstep(0.25, 0.5, r).oneMinus();
    const circle = smoothstep(0, 0.05, r.sub(0.44).abs())
      .oneMinus()
      .add(smoothstep(0.06, 0.12, r).oneMinus());
    material.colorNode = color(INK);
    material.opacityNode = mix(dot, circle, ring);
    const sprite = new Sprite(material);
    sprite.count = 0;
    return sprite;
  }

  /**
   * Poussiere dans l'air, comme chez Chartogne-Taillet : des grains fixes dans la scene (ils glissent avec le sol),
   * repartis dans un cube qui suit la camera, portes par un vent lent : quand la vue avance, ils defilent en sens
   * inverse et reparaissent de l'autre cote du cube. Plus petits au loin, effaces tout pres ; en cercles vides.
   */
  private _createDust(): Sprite {
    const seeds = new Float32Array(DUST * 4);
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
    const seed = instancedBufferAttribute(new InstancedBufferAttribute(seeds, 4));
    const material = new PointsNodeMaterial({ sizeAttenuation: false, alphaTest: 0.5 });
    const box = float(DUST_BOX);
    const wind = vec3(Math.sin(1), 0, Math.cos(1)).mul(this._clock.mul(DUST_WIND));
    const flutter = vec3(0, sin(this._clock.mul(0.6).add(seed.x.mul(6))).mul(0.4), 0);
    const grain = seed.xyz
      .mul(box.mul(2))
      .add(vec3(this._drift.x, 0, this._drift.y))
      .add(wind)
      .add(flutter);
    // Toujours dans le cube autour de la camera : chaque grain reparait de l'autre cote quand elle s'en eloigne.
    const world = mod(grain.sub(cameraPosition), box.mul(2)).sub(box).add(cameraPosition);
    material.positionNode = world;
    const depth = cameraViewMatrix.mul(vec4(world, 1)).z.negate();
    const far = float(1).sub(depth.div(box).clamp(0, 1));
    const near = depth.sub(DUST_NEAR).div(DUST_NEAR).clamp(0, 1);
    const size = this._dustSize
      .mul(DUST_SIZE)
      .mul(far)
      .mul(near)
      .mul(mix(float(0.45), float(1), seed.w));
    material.sizeNode = size.mul(step(2.5, size));
    const r = length(uv().sub(0.5));
    material.colorNode = color(INK);
    material.opacityNode = smoothstep(0.34, 0.38, r).mul(smoothstep(0.46, 0.5, r).oneMinus());
    const sprite = new Sprite(material);
    sprite.count = DUST;
    return sprite;
  }

  /** La poussiere se decale comme le sol : de la position du centre precedent dans la vue actuelle. */
  private _followGround(): void {
    const { center } = this._terrain;
    if (this._anchor) {
      const shift = this._terrain.sceneOf(this._anchor.lon, this._anchor.lat);
      this._drift.value.x += shift.x;
      this._drift.value.y += shift.z;
    }
    this._anchor = { ...center };
  }

  private _rebuild(): void {
    const terrain = this._terrain;
    const b = terrain.bounds;
    const ground = expandBounds(b, (SPAN - 1) / 2);
    const step = graticuleStep(b, MAX_LINES);
    const lons = graticuleValues(ground.west, ground.east, step);
    const lats = graticuleValues(ground.south, ground.north, step);
    const u = (lon: number) => (lon - b.west) / (b.east - b.west);
    const v = (lat: number) => (b.north - lat) / (b.north - b.south);
    const across = (t: number) => GROUND_MIN + t * SPAN;

    // Drapees, en uv du bloc.
    const draped: number[] = [];
    const segment = (from: (t: number) => [number, number]) => {
      for (let i = 0; i < SAMPLES; i++) {
        const [x0, z0] = from(i / SAMPLES);
        const [x1, z1] = from((i + 1) / SAMPLES);
        draped.push(x0, 0, z0, x1, 0, z1);
      }
    };
    for (const lon of lons) segment((t) => [u(lon), across(t)]);
    for (const lat of lats) segment((t) => [across(t), v(lat)]);
    setPositions(this._draped.geometry, draped);

    // Croisements ; l'anneau marque le plus proche du centre.
    const crossings = lons.flatMap((lon) => lats.map((lat) => [u(lon), v(lat)] as const));
    const central = crossings.reduce(
      (best, c, i) => (Math.hypot(c[0] - 0.5, c[1] - 0.5) < Math.hypot(crossings[best]![0] - 0.5, crossings[best]![1] - 0.5) ? i : best),
      0,
    );
    const count = Math.min(crossings.length, this._crossings.count);
    for (let i = 0; i < count; i++) this._crossings.setXYZ(i, crossings[i]![0], crossings[i]![1], i === central ? 1 : 0);
    this._crossings.needsUpdate = true;
    this._dots.count = count;

    // Coordonnees sur les bords nord et ouest de la zone de detail.
    const inside = (x: number) => x >= 0 && x <= 1;
    this._rebuildTexts([
      ...lons
        .filter((lon) => inside(u(lon)))
        .map((lon) => ({ text: formatDegrees(lon, step, "E", "W"), u: u(lon), v: 0, side: "north" as const })),
      ...lats
        .filter((lat) => inside(v(lat)))
        .map((lat) => ({ text: formatDegrees(lat, step, "N", "S"), u: 0, v: v(lat), side: "west" as const })),
    ]);
  }

  private _rebuildTexts(items: { text: string; u: number; v: number; side: SurveyText["side"] }[]): void {
    if (!this._layer) return;
    while (this._texts.length > items.length) this._texts.pop()!.root.remove();
    while (this._texts.length < items.length) {
      const root = document.createElement("span");
      root.className = "map-survey__text";
      this._layer.append(root);
      this._texts.push({ root, u: 0, v: 0, side: "north" });
    }
    items.forEach((item, i) => {
      const text = this._texts[i]!;
      Object.assign(text, { u: item.u, v: item.v, side: item.side });
      // Reecrire un texte identique relance la mise en page a chaque image du deplacement.
      if (text.root.textContent !== item.text) text.root.textContent = item.text;
      if (text.root.dataset.side !== item.side) text.root.dataset.side = item.side;
    });
  }

  private _layoutTexts(): void {
    const { minX, maxX, minZ, maxZ } = this._terrain.detailRect;
    const camera = this._camera();
    const { clientWidth: width, clientHeight: height } = this._canvas;
    for (const text of this._texts) {
      const x = minX + text.u * (maxX - minX);
      const z = minZ + text.v * (maxZ - minZ);
      this._point.set(x, this._terrain.heightAt(x, z), z).project(camera);
      const sx = ((this._point.x + 1) / 2) * width;
      const sy = ((1 - this._point.y) / 2) * height;
      const dx = text.side === "west" ? -LABEL_OFFSET_PX : 0;
      const dy = text.side === "north" ? -LABEL_OFFSET_PX : 0;
      text.root.style.transform = `translate3d(${sx + dx}px, ${sy + dy}px, 0)`;
    }
  }
}

function setPositions(geometry: BufferGeometry, positions: number[]): void {
  const attribute = geometry.getAttribute("position") as BufferAttribute;
  if (attribute.array.length === positions.length) {
    attribute.copyArray(positions);
    attribute.needsUpdate = true;
    return;
  }
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
}
