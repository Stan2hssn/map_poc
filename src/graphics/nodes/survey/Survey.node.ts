import { Object3DNodeBase } from "@_core/nodes/object3d/Object3DNode.base.ts";
import { terrainHeight, terrainSettings } from "@graphics/materials/Terrain.material.ts";
import { NODE_ID } from "@graphics/nodes/Node.id.ts";
import type { TerrainNode } from "@graphics/nodes/terrain/Terrain.node.ts";
import { expandBounds } from "@graphics/terrain/GeoProjection.ts";
import { formatDegrees, graticuleStep, graticuleValues } from "@graphics/terrain/Graticule.ts";
import {
  AdditiveBlending,
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
  color,
  float,
  instancedBufferAttribute,
  length,
  min,
  mix,
  mod,
  positionGeometry,
  positionWorld,
  sin,
  smoothstep,
  uniform,
  uv,
  vec2,
  vec3,
} from "three/tsl";
import { LineBasicNodeMaterial, PointsNodeMaterial, type Node } from "three/webgpu";

/** Au plus autant de meridiens sur la largeur du bloc. */
const MAX_LINES = 6;
/** Points par ligne drapee, et hauteur au-dessus du sol. */
const SAMPLES = 160;
const LIFT = 0.15;
/** Lignes qui flottent au-dessus du relief et debordent du bloc. */
const FLOAT_HEIGHT = 32;
const FLOAT_REACH = 170;
const DUST = 260;
const DUST_REACH = 70;
const LABEL_OFFSET_PX = 14;

interface SurveyText {
  root: HTMLElement;
  u: number;
  v: number;
  side: "north" | "west";
}

const additive = { transparent: true, depthWrite: false, blending: AdditiveBlending } as const;
// Sur le relief clair, les traces au sol sont sombres ; dans le vide, elles sont blanches.
const onGround = { transparent: true, depthWrite: false } as const;
const INK = 0x1c1c1c;

function lineGeometry(): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(0), 3));
  return geometry;
}

/**
 * Releves flottants, facon generique de film : graticule drapee sur le relief, lignes qui flottent
 * au-dessus et debordent du bloc, points aux croisements, poussiere en suspension, coordonnees espacees.
 */
export class SurveyNode extends Object3DNodeBase {
  private readonly _terrain: TerrainNode;
  private readonly _canvas: HTMLElement;
  private readonly _camera: () => Camera;
  private readonly _blockSpace = new Group();
  private readonly _draped = new LineSegments(lineGeometry(), new LineBasicNodeMaterial(onGround));
  private readonly _floating = new LineSegments(lineGeometry(), new LineBasicNodeMaterial(additive));
  private readonly _crossings = new InstancedBufferAttribute(new Float32Array((MAX_LINES + 2) ** 2 * 3), 3);
  private readonly _dots: Sprite;
  private readonly _dust: Sprite;
  private readonly _clock = uniform(0);
  private readonly _drift = uniform(new Vector2());
  private readonly _point = new Vector3();
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
    group.add(this._blockSpace, this._floating, this._dots, this._dust);
    for (const object of [this._draped, this._floating, this._dots, this._dust]) object.frustumCulled = false;
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
    if (terrain.viewVersion !== this._version) {
      this._version = terrain.viewVersion;
      this._rebuild();
    }
    this._layoutTexts();
  }

  override dispose(): void {
    this._layer?.remove();
    for (const object of [this._draped, this._floating]) object.geometry.dispose();
    for (const object of [this._draped, this._floating, this._dots, this._dust]) (object.material as { dispose(): void }).dispose();
    super.dispose();
  }

  private _setupLines(): void {
    // Drapees : x, z sont les uv du bloc ; fondu sur ses bords.
    const draped = this._draped.material as LineBasicNodeMaterial;
    const blockUv = positionGeometry.xz;
    draped.positionNode = vec3(blockUv.x, terrainHeight(blockUv).add(LIFT), blockUv.y);
    const edge = min(min(blockUv.x, blockUv.y), min(blockUv.x.oneMinus(), blockUv.y.oneMinus()));
    draped.colorNode = color(INK);
    draped.opacityNode = smoothstep(0, 0.05, edge).mul(0.55);

    // Flottantes : dans la scene, de plus en plus transparentes en s'eloignant du centre.
    const floating = this._floating.material as LineBasicNodeMaterial;
    floating.colorNode = vec3(1);
    floating.opacityNode = smoothstep(FLOAT_REACH, 30, length(positionWorld.xz)).mul(0.16);
  }

  /** Croisements drapes : un point, et un anneau pour le plus central. */
  private _createDots(): Sprite {
    const material = new PointsNodeMaterial({ ...onGround, sizeAttenuation: false });
    const crossing = instancedBufferAttribute(this._crossings);
    const block = terrainSettings.blockSize;
    const at = crossing.xy;
    material.positionNode = vec3(at.x.sub(0.5).mul(block.x), terrainHeight(at).add(LIFT * 2), at.y.sub(0.5).mul(block.y));
    const ring = crossing.z;
    material.sizeNode = mix(float(5), float(22), ring);
    const r = length(uv().sub(0.5));
    const dot = smoothstep(0.5, 0.25, r);
    const circle = smoothstep(0.05, 0, r.sub(0.44).abs()).add(smoothstep(0.12, 0.06, r));
    material.colorNode = color(INK);
    material.opacityNode = mix(dot, circle, ring).mul(0.85);
    const sprite = new Sprite(material);
    sprite.count = 0;
    return sprite;
  }

  /** Poussiere en suspension au-dessus du bloc, qui suit le terrain quand il glisse. */
  private _createDust(): Sprite {
    const seeds = new Float32Array(DUST * 4);
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
    const seed = instancedBufferAttribute(new InstancedBufferAttribute(seeds, 4));
    const material = new PointsNodeMaterial({ ...additive, sizeAttenuation: false });
    const reach = float(DUST_REACH * 2);
    const wander = vec2(sin(this._clock.mul(0.13).add(seed.w.mul(40))), sin(this._clock.mul(0.11).add(seed.x.mul(40)))).mul(1.5);
    const ground = mod(seed.xy.mul(reach).add(this._drift).add(wander), reach).sub(DUST_REACH);
    const height = mix(float(3), float(48), seed.z).add(sin(this._clock.mul(0.2).add(seed.y.mul(30))).mul(1.2));
    material.positionNode = vec3(ground.x, height, ground.y);
    material.sizeNode = mix(float(1.5), float(3.5), seed.w);
    const fade = smoothstep(DUST_REACH, DUST_REACH * 0.4, length(ground));
    const r = length(uv().sub(0.5));
    material.colorNode = vec3(1);
    material.opacityNode = smoothstep(0.5, 0.1, r).mul(fade).mul(mix(float(0.15), float(0.55), seed.x)) as Node;
    const sprite = new Sprite(material);
    sprite.count = DUST;
    return sprite;
  }

  /** La poussiere se decale comme le sol : de la position du centre precedent dans la vue actuelle. */
  private _followGround(): void {
    const { center } = this._terrain;
    if (this._anchor) {
      const moved = this._terrain.sceneOf(this._anchor.lon, this._anchor.lat);
      this._drift.value.x += moved.x;
      this._drift.value.y += moved.z;
    }
    this._anchor = { ...center };
  }

  private _rebuild(): void {
    const terrain = this._terrain;
    const b = terrain.bounds;
    const step = graticuleStep(b, MAX_LINES);
    const lons = graticuleValues(b.west, b.east, step);
    const lats = graticuleValues(b.south, b.north, step);
    const u = (lon: number) => (lon - b.west) / (b.east - b.west);
    const v = (lat: number) => (b.north - lat) / (b.north - b.south);

    // Drapees, en uv du bloc.
    const draped: number[] = [];
    const segment = (from: (t: number) => [number, number]) => {
      for (let i = 0; i < SAMPLES; i++) {
        const [x0, z0] = from(i / SAMPLES);
        const [x1, z1] = from((i + 1) / SAMPLES);
        draped.push(x0, 0, z0, x1, 0, z1);
      }
    };
    for (const lon of lons) segment((t) => [u(lon), t]);
    for (const lat of lats) segment((t) => [t, v(lat)]);
    setPositions(this._draped.geometry, draped);

    // Flottantes, dans la scene, sur une emprise plus large que le bloc.
    const wide = expandBounds(b, 1);
    const floating: number[] = [];
    for (const lon of graticuleValues(wide.west, wide.east, step)) {
      const { x } = terrain.sceneOf(lon, 0);
      floating.push(x, FLOAT_HEIGHT, -FLOAT_REACH, x, FLOAT_HEIGHT, FLOAT_REACH);
    }
    for (const lat of graticuleValues(wide.south, wide.north, step)) {
      const { z } = terrain.sceneOf(terrain.center.lon, lat);
      floating.push(-FLOAT_REACH, FLOAT_HEIGHT, z, FLOAT_REACH, FLOAT_HEIGHT, z);
    }
    setPositions(this._floating.geometry, floating);

    // Croisements ; l'anneau marque le plus proche du centre.
    const crossings = lons.flatMap((lon) => lats.map((lat) => [u(lon), v(lat)] as const));
    const central = crossings.reduce(
      (best, c, i) => (Math.hypot(c[0] - 0.5, c[1] - 0.5) < Math.hypot(crossings[best]![0] - 0.5, crossings[best]![1] - 0.5) ? i : best),
      0
    );
    const count = Math.min(crossings.length, this._crossings.count);
    for (let i = 0; i < count; i++) this._crossings.setXYZ(i, crossings[i]![0], crossings[i]![1], i === central ? 1 : 0);
    this._crossings.needsUpdate = true;
    this._dots.count = count;

    this._rebuildTexts([
      ...lons.map((lon) => ({ text: formatDegrees(lon, step, "E", "W"), u: u(lon), v: 0, side: "north" as const })),
      ...lats.map((lat) => ({ text: formatDegrees(lat, step, "N", "S"), u: 0, v: v(lat), side: "west" as const })),
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
      text.root.textContent = item.text;
      text.root.dataset.side = item.side;
    });
  }

  private _layoutTexts(): void {
    const { minX, maxX, minZ, maxZ } = this._terrain.blockTop;
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
