import { Object3DNodeBase } from "@_core/nodes/object3d/Object3DNode.base.ts";
import { TERRAIN_CONFIG } from "@graphics/config/terrain.config.ts";
import { createTerrainMaterial, terrainSettings } from "@graphics/materials/Terrain.material.ts";
import { NODE_ID } from "@graphics/nodes/Node.id.ts";
import { createGroundGeometry } from "@graphics/terrain/GroundGeometry.ts";
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
import { INK_PERIOD } from "@graphics/postprocessing/effects/InkStyle.ts";
import { Group, MathUtils, Mesh, Vector3, type Camera, type Object3D } from "three";
import { LandcoverHelper } from "./Landcover.helper.ts";
import { TerrainHeightsHelper, type HeightsView } from "./TerrainHeights.helper.ts";

const C = TERRAIN_CONFIG;
// Temps de reponse du plancher et du relief quand la vue change.
const RANGE_EASE_MS = 150;
// Glisse apres un lancer : temps de freinage, et vitesse sous laquelle elle s'arrete (unites par ms).
const GLIDE_MS = 380;
const GLIDE_STOP = 1e-4;
// Cellules de bruit de la brume sur la largeur du bloc (entre 1 et 2 fois ce nombre), et leur derive par seconde.
const MIST_CELLS = 3;
const MIST_DRIFT = { x: 0.004, y: 0.0025 };
// Pseudo-pixels d'encre par cellule de brume : 3 a 6 cellules sur la largeur de la vue.
const INK_CELL_PX = 600;
const LOOK = new Vector3();

/**
 * Sol plein ecran, fixe dans la scene, fenetre sur le terrain : glisser deplace le centre (avec
 * glisse au relacher), la molette change la largeur de la zone de detail (le carre central).
 * Au-dela d'une demi-circonference, elle s'aplatit en profondeur jusqu'au monde entier (2:1).
 */
export class TerrainNode extends Object3DNodeBase {
  readonly center: { lon: number; lat: number } = { ...C.center };
  /** Zone de detail maximale (carre), pour cadrer la camera. */
  readonly rect: SceneRect;
  readonly settings = { segments: C.segments as number, exaggeration: 2.5 };
  extentKm: number = C.extentKm;
  /** Incremente a chaque changement de vue. */
  viewVersion = 0;
  /** Camera depuis laquelle la grille de l'ecran est projetee sur le sol. */
  projectFrom: (() => Camera) | null = null;
  /** Texture de donnees, hauteurs et volumes du bati. */
  readonly landcover = new LandcoverHelper();
  /** Dessiner aussi les hauteurs du bati (bati en relief a l'ecran). */
  withBuildingHeights = false;
  private readonly _mesh: Mesh;
  private readonly _blockSpace = new Group();
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
  private readonly _glide = { x: 0, z: 0 };
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
    // La grille est placee dans la scene par le shader : pas de transformation, pas de culling.
    mesh.frustumCulled = false;
    this._blockSpace.position.set(-half, 0, -half);
    this._blockSpace.scale.set(C.blockSize, 1, C.blockSize);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
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

  /** Zone de detail dans la scene. */
  get detailRect(): SceneRect {
    const half = C.blockSize / 2;
    return { minX: -half, maxX: half, minZ: -half * this._depth, maxZ: half * this._depth };
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

  /** Place les uv de la zone de detail (0..1) dans la scene. */
  get block(): Object3D {
    return this._blockSpace;
  }

  /** Deplace le centre de (dx, dz) unites de scene. */
  moveBy(dx: number, dz: number): void {
    this._flight = null;
    this._glide.x = this._glide.z = 0;
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

  /** Lance le terrain (unites de scene par ms) ; il glisse puis freine. */
  fling(vx: number, vz: number): void {
    this._glide.x = vx;
    this._glide.z = vz;
  }

  /** Vol vers une vue ; s'il va loin, il prend de la hauteur a mi-chemin. */
  flyTo(view: MapView): void {
    this._glide.x = this._glide.z = 0;
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
    this._mesh.geometry = createGroundGeometry(this._segments);
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
    this._glideStep(dt);
    this._heights.update(this._view(), this._flight?.destination);
    this.landcover.update(this._bounds, this.withBuildingHeights, this._flight?.destination.bounds);
    this._easeRange(dt);
    terrainSettings.mistDrift.value.x += (MIST_DRIFT.x * dt) / 1000;
    terrainSettings.mistDrift.value.y += (MIST_DRIFT.y * dt) / 1000;
    this._syncUniforms();
  }

  override dispose(): void {
    this._heights.dispose();
    this.landcover.dispose();
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

  private _glideStep(dt: number): void {
    const g = this._glide;
    if (Math.hypot(g.x, g.z) < GLIDE_STOP) return;
    this._moveCenter(g.x * dt * this.kmPerUnit, g.z * dt * this.kmPerUnit);
    const k = Math.exp(-dt / GLIDE_MS);
    g.x *= k;
    g.z *= k;
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
    this._blockSpace.scale.z = C.blockSize * this._depth;
    this._blockSpace.position.z = (-C.blockSize * this._depth) / 2;
    this._range = null;
    this.viewVersion++;
  }

  private _syncUniforms(): void {
    const s = terrainSettings;
    const camera = this.projectFrom?.();
    if (camera) {
      camera.updateMatrixWorld();
      s.viewWorld.value.copy(camera.matrixWorld);
      s.viewProjectionInverse.value.copy(camera.projectionMatrixInverse);
      s.viewOrigin.value.setFromMatrixPosition(camera.matrixWorld);
      // Centre du dessin : la ou regarde la camera, au sol.
      const look = LOOK.set(0, 0, -1).transformDirection(camera.matrixWorld);
      const reach = s.viewOrigin.value.y / Math.max(-look.y, 1e-3);
      s.maskCenter.value.set(s.viewOrigin.value.x + look.x * reach, s.viewOrigin.value.z + look.z * reach + s.maskShift.value);
    }
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
    // Encre accrochee a la carte, aux echelles de la brume : origine recalee d'une periode entiere,
    // en double precision ici, pour que le shader ne manipule que de petits ecarts.
    const [near, next] = [scale * INK_CELL_PX, (scale / 2) * INK_CELL_PX];
    const origin = (f: number, g: number) => g - Math.floor((g * f) / INK_PERIOD) * (INK_PERIOD / f);
    const [x, y] = [b.west * cos, b.north];
    s.inkScale.value.set(near, next);
    s.inkOrigin.value.set(origin(near, x), origin(near, y), origin(next, x), origin(next, y));
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
