import { Object3DNodeBase } from "@_core/nodes/object3d/Object3DNode.base.ts";
import { TERRAIN_CONFIG } from "@graphics/config/terrain.config.ts";
import { createTerrainMaterial, terrainSettings } from "@graphics/materials/Terrain.material.ts";
import { NODE_ID } from "@graphics/nodes/Node.id.ts";
import { createBlockGeometry } from "@graphics/terrain/BlockGeometry.ts";
import type IElevationProvider from "@graphics/terrain/ElevationProvider.interface.ts";
import {
  clampCenter,
  GeoProjection,
  KM_PER_DEGREE,
  WORLD_HEIGHT_KM,
  type GeoBounds,
  type SceneRect,
} from "@graphics/terrain/GeoProjection.ts";
import { levelFor } from "@graphics/terrain/HeightMosaic.ts";
import type { MapView } from "@graphics/universes/MapNavigator.interface.ts";
import { MathUtils, Mesh, type Object3D } from "three";
import { TerrainHeightsHelper, type HeightsView } from "./TerrainHeights.helper.ts";

const C = TERRAIN_CONFIG;
// Temps de reponse du plancher et du relief quand la vue change.
const RANGE_EASE_MS = 150;
// Cellules de bruit de la brume sur la largeur du bloc (entre 1 et 2 fois ce nombre), et leur derive par seconde.
const MIST_CELLS = 3;
const MIST_DRIFT = { x: 0.004, y: 0.0025 };

/**
 * Bloc de relief fixe dans la scene, fenetre sur le terrain : glisser deplace le centre,
 * la molette change la largeur couverte. Les tuiles autour de la fenetre sont prechargees.
 * Au-dela d'une demi-circonference, le bloc s'aplatit en profondeur jusqu'au monde entier (2:1).
 */
export class TerrainNode extends Object3DNodeBase {
  readonly center: { lon: number; lat: number } = { ...C.center };
  /** Emprise maximale du bloc (carre), pour cadrer la camera. */
  readonly rect: SceneRect;
  readonly settings = { segments: C.segments as number, exaggeration: 2.5 };
  extentKm: number = C.extentKm;
  /** Incremente a chaque changement de vue. */
  viewVersion = 0;
  private readonly _mesh: Mesh;
  private readonly _heights: TerrainHeightsHelper;
  private _projection = new GeoProjection(this.center.lon, this.center.lat);
  private _bounds: GeoBounds = this._projection.bounds(this.extentKm);
  /** Profondeur du bloc rapportee a sa largeur. */
  private _depth = 1;
  private _level = 0;
  private _segments = 0;
  /** Altitudes (m) min et max sous le bloc : cible, et valeurs lissees affichees. */
  private _range: { min: number; max: number } | null = null;
  private _rangeVersion = -1;
  private _floor = 0;
  private _relief = 0;
  private _flight: {
    from: MapView;
    to: MapView;
    destination: HeightsView;
    bump: number;
    duration: number;
    elapsed: number;
  } | null = null;

  constructor(provider: IElevationProvider) {
    const mesh = new Mesh(undefined, createTerrainMaterial());
    super(NODE_ID.TERRAIN, "Terrain", mesh);
    const half = C.blockSize / 2;
    this.rect = { minX: -half, maxX: half, minZ: -half, maxZ: half };
    this._mesh = mesh;
    this._heights = new TerrainHeightsHelper(provider);
    mesh.position.set(-half, 0, -half);
    mesh.scale.set(C.blockSize, 1, C.blockSize);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    terrainSettings.baseDepth.value = C.baseDepth;
    this._setView();
    this.applySettings();
  }

  /** km par unite de scene. */
  get kmPerUnit(): number {
    return this.extentKm / C.blockSize;
  }

  /**
   * Unites de scene par metre d'altitude. L'exageration suit la racine de la largeur :
   * les grandes vues ne s'aplatissent pas, les petites ne se herissent pas.
   */
  get heightScale(): number {
    const scale = (0.001 / this.kmPerUnit) * this.settings.exaggeration * Math.sqrt(this.extentKm / C.referenceExtentKm);
    return Math.min(scale, C.maxRelief / Math.max(this._relief, 1));
  }

  get bounds(): GeoBounds {
    return this._bounds;
  }

  /** Dessus du bloc dans la scene, et hauteur du plus haut relief affiche. */
  get blockTop(): SceneRect & { top: number } {
    const half = C.blockSize / 2;
    return { minX: -half, maxX: half, minZ: -half * this._depth, maxZ: half * this._depth, top: this._relief * this.heightScale };
  }

  get pendingCount(): number {
    return this._heights.pendingCount;
  }

  get flying(): boolean {
    return !!this._flight;
  }

  /** Position (unites de scene) d'un point geographique, meme hors du bloc. */
  sceneOf(lon: number, lat: number): { x: number; z: number } {
    const k = this.kmPerUnit;
    return { x: this._projection.x(lon) / k, z: this._projection.z(lat) / k };
  }

  /** Position (unites de scene) d'un point geographique, null hors du bloc. */
  toScene(lon: number, lat: number): { x: number; z: number } | null {
    const b = this._bounds;
    if (lon < b.west || lon > b.east || lat < b.south || lat > b.north) return null;
    return this.sceneOf(lon, lat);
  }

  /** Le bloc : sa transformation place les uv (0..1) du dessus dans la scene. */
  get block(): Object3D {
    return this._mesh;
  }

  /** Deplace le centre de (dx, dz) unites de scene. */
  moveBy(dx: number, dz: number): void {
    this._flight = null;
    this._moveCenter(dx * this.kmPerUnit, dz * this.kmPerUnit);
  }

  /** Change la largeur couverte en gardant fixe le terrain sous le point (x, z) de la scene. */
  zoomAt(factor: number, x: number, z: number): void {
    this._flight = null;
    const before = this.kmPerUnit;
    this.extentKm = MathUtils.clamp(this.extentKm * factor, C.minExtentKm, C.maxExtentKm);
    const shift = before - this.kmPerUnit;
    this._moveCenter(x * shift, z * shift);
  }

  /** Vol vers une vue ; s'il va loin, il prend de la hauteur a mi-chemin. */
  flyTo(view: MapView): void {
    const from = { ...this.center, extentKm: this.extentKm };
    const to = { ...view, extentKm: MathUtils.clamp(view.extentKm, C.minExtentKm, C.maxExtentKm) };
    const distanceKm = Math.hypot(new GeoProjection(from.lon, from.lat).x(to.lon), (to.lat - from.lat) * KM_PER_DEGREE);
    const middle = (Math.log(from.extentKm) + Math.log(to.extentKm)) / 2;
    const bump = Math.max(0, Math.log(Math.min(distanceKm * 2, C.maxExtentKm)) - middle);
    this._flight = { from, to, destination: this._viewOf(to), bump, duration: 1400 + 500 * Math.min(bump, 3), elapsed: 0 };
  }

  /** Altitude affichee (unites de scene) au point (x, z) de la scene. */
  heightAt(x: number, z: number): number {
    const k = this.kmPerUnit;
    const height = this._heights.heightAt(this._projection.lon(x * k), this._projection.lat(z * k));
    return (height - this._floor) * this.heightScale;
  }

  applySettings(): void {
    if (this.settings.segments === this._segments) return;
    this._segments = this.settings.segments;
    this._mesh.geometry.dispose();
    this._mesh.geometry = createBlockGeometry(this._segments);
    this._setView();
  }

  // L'apercu est attendu : le bloc n'apparait pas a plat.
  override async beforeMount(): Promise<void> {
    if (this._heights.ready) return;
    this._heights.update(this._view());
    const deadline = performance.now() + 5000;
    while (!this._heights.coarseLoaded(this._bounds, this._level) && performance.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    this._heights.update(this._view());
    this._easeRange(Infinity);
    this._syncUniforms();
  }

  override update(_time: number, dt: number): void {
    this._fly(dt);
    this._heights.update(this._view(), this._flight?.destination);
    this._easeRange(dt);
    terrainSettings.mistDrift.value.x += (MIST_DRIFT.x * dt) / 1000;
    terrainSettings.mistDrift.value.y += (MIST_DRIFT.y * dt) / 1000;
    this._syncUniforms();
  }

  override dispose(): void {
    this._heights.dispose();
    terrainSettings.mistNoise.value.dispose();
    this._mesh.geometry.dispose();
    (this._mesh.material as { dispose(): void }).dispose();
    super.dispose();
  }

  private _moveCenter(dxKm: number, dzKm: number): void {
    this.center.lon = this._projection.lon(dxKm);
    this.center.lat = this._projection.lat(dzKm);
    this._setView();
  }

  private _fly(dt: number): void {
    const f = this._flight;
    if (!f) return;
    f.elapsed += dt;
    const t = Math.min(1, f.elapsed / f.duration);
    const e = t < 0.5 ? 4 * t ** 3 : 1 - (2 - 2 * t) ** 3 / 2;
    this.center.lon = MathUtils.lerp(f.from.lon, f.to.lon, e);
    this.center.lat = MathUtils.lerp(f.from.lat, f.to.lat, e);
    const logExtent = MathUtils.lerp(Math.log(f.from.extentKm), Math.log(f.to.extentKm), e) + f.bump * Math.sin(Math.PI * e);
    this.extentKm = MathUtils.clamp(Math.exp(logExtent), C.minExtentKm, C.maxExtentKm);
    if (t === 1) this._flight = null;
    this._setView();
  }

  private _view(): HeightsView {
    return { bounds: this._bounds, level: this._level, center: this.center };
  }

  /** Vue d'arrivee d'un vol, bornee comme `_setView` la bornera. */
  private _viewOf({ lon, lat, extentKm }: MapView): HeightsView {
    const heightKm = Math.min(extentKm, WORLD_HEIGHT_KM);
    const center = clampCenter(lon, lat, extentKm, heightKm, C.centerBounds);
    const bounds = new GeoProjection(center.lon, center.lat).bounds(extentKm, heightKm);
    return { bounds, level: levelFor(extentKm, this._segments || C.segments, C.maxZoom), center };
  }

  private _setView(): void {
    const view = this._viewOf({ ...this.center, extentKm: this.extentKm });
    Object.assign(this.center, view.center);
    this._projection = new GeoProjection(this.center.lon, this.center.lat);
    this._bounds = view.bounds;
    this._level = view.level;
    this._depth = Math.min(this.extentKm, WORLD_HEIGHT_KM) / this.extentKm;
    this._mesh.scale.z = C.blockSize * this._depth;
    this._mesh.position.z = (-C.blockSize * this._depth) / 2;
    this._range = null;
    this.viewVersion++;
  }

  private _syncUniforms(): void {
    const s = terrainSettings;
    const b = this._bounds;
    s.heightScale.value = this.heightScale;
    s.floor.value = this._floor;
    s.relief.value = this._relief;
    s.blockSize.value.set(C.blockSize, C.blockSize * this._depth);
    const cos = Math.cos(MathUtils.degToRad(this.center.lat));
    s.geoOrigin.value.set(b.west, b.north);
    s.geoSize.value.set(b.east - b.west, b.south - b.north);
    s.geoCos.value = cos;
    const octave = Math.log2((b.east - b.west) * cos);
    const scale = MIST_CELLS * 2 ** -Math.floor(octave);
    s.mistScales.value.set(scale, scale / 2);
    s.mistBlend.value = octave - Math.floor(octave);
  }

  private _easeRange(dt: number): void {
    if (this._rangeVersion !== this._heights.version) this._range = null;
    this._rangeVersion = this._heights.version;
    this._range ??= this._heights.range(this._bounds);
    if (!this._range) return;
    const k = 1 - Math.exp(-dt / RANGE_EASE_MS);
    this._floor += (this._range.min - this._floor) * k;
    this._relief += (this._range.max - this._range.min - this._relief) * k;
  }
}
