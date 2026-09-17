import { Object3DNodeBase } from "@_core/nodes/object3d/Object3DNode.base.ts";
import { TERRAIN_CONFIG } from "@graphics/config/terrain.config.ts";
import { createTerrainMaterial, terrainSettings } from "@graphics/materials/Terrain.material.ts";
import { NODE_ID } from "@graphics/nodes/Node.id.ts";
import { createBlockGeometry } from "@graphics/terrain/BlockGeometry.ts";
import type IElevationProvider from "@graphics/terrain/ElevationProvider.interface.ts";
import {
  containsBounds,
  expandBounds,
  GeoProjection,
  tileBounds,
  tilesCovering,
  type GeoBounds,
  type SceneRect,
} from "@graphics/terrain/GeoProjection.ts";
import { composeMosaic, levelFor, mosaicHeightAt, mosaicRange, mosaicUvTransform, type HeightMosaic } from "@graphics/terrain/HeightMosaic.ts";
import { TileCache, type TileId } from "@graphics/terrain/TileCache.ts";
import { DataTexture, HalfFloatType, LinearFilter, MathUtils, Mesh, RedFormat } from "three";

const C = TERRAIN_CONFIG;
// Pendant un chargement, la mosaique est recomposee au plus a ce rythme.
const RECOMPOSE_MS = 150;
// Temps de reponse du plancher et du relief quand la vue change.
const RANGE_EASE_MS = 150;

/**
 * Bloc de relief fixe dans la scene, fenetre sur le terrain : glisser deplace le centre,
 * la molette change la largeur couverte. Les tuiles autour de la fenetre sont prechargees.
 */
export class TerrainNode extends Object3DNodeBase {
  readonly center: { lon: number; lat: number } = { ...C.center };
  readonly rect: SceneRect;
  readonly settings = { segments: C.segments as number, exaggeration: 2.5 };
  extentKm: number = C.extentKm;
  private readonly _mesh: Mesh;
  private readonly _cache: TileCache;
  private _projection = new GeoProjection(this.center.lon, this.center.lat);
  private _bounds: GeoBounds = this._projection.squareBounds(this.extentKm);
  private _level = 0;
  private _mosaic: { data: HeightMosaic; level: number } | null = null;
  private _requested = "";
  private _tilesChanged = false;
  private _lastCompose = 0;
  private _segments = 0;
  /** Altitudes (m) min et max sous le bloc : cible, et valeurs lissees affichees. */
  private _range: { min: number; max: number } | null = null;
  private _floor = 0;
  private _relief = 0;

  constructor(provider: IElevationProvider) {
    const mesh = new Mesh(undefined, createTerrainMaterial());
    super(NODE_ID.TERRAIN, "Terrain", mesh);
    const half = C.blockSize / 2;
    this.rect = { minX: -half, maxX: half, minZ: -half, maxZ: half };
    this._mesh = mesh;
    this._cache = new TileCache(provider, C.cacheTiles, () => {
      this._tilesChanged = true;
    });
    mesh.position.set(-half, 0, -half);
    mesh.scale.set(C.blockSize, 1, C.blockSize);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    terrainSettings.baseDepth.value = C.baseDepth;
    terrainSettings.blockSize.value = C.blockSize;
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

  /** Deplace le centre de (dx, dz) unites de scene. */
  moveBy(dx: number, dz: number): void {
    this._moveCenter(dx * this.kmPerUnit, dz * this.kmPerUnit);
  }

  /** Change la largeur couverte en gardant fixe le terrain sous le point (x, z) de la scene. */
  zoomAt(factor: number, x: number, z: number): void {
    const before = this.kmPerUnit;
    this.extentKm = MathUtils.clamp(this.extentKm * factor, C.minExtentKm, C.maxExtentKm);
    const shift = before - this.kmPerUnit;
    this._moveCenter(x * shift, z * shift);
  }

  /** Altitude affichee (unites de scene) au point (x, z) de la scene. */
  heightAt(x: number, z: number): number {
    if (!this._mosaic) return 0;
    const k = this.kmPerUnit;
    const height = mosaicHeightAt(this._mosaic.data, this._projection.lon(x * k), this._projection.lat(z * k));
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
    if (this._mosaic) return;
    this._request();
    const deadline = performance.now() + 5000;
    while (!this._coarseReady() && performance.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    this._compose();
    this._easeRange(Infinity);
  }

  override update(_time: number, dt: number): void {
    this._request();
    const m = this._mosaic;
    const stale = !m || m.level !== this._level || !containsBounds(m.data.bounds, this._bounds);
    const refining = m && !m.data.complete && this._tilesChanged && performance.now() - this._lastCompose > RECOMPOSE_MS;
    if (stale || refining) this._compose();
    this._easeRange(dt);
    this._syncUniforms();
  }

  override dispose(): void {
    this._cache.dispose();
    terrainSettings.heights.value.dispose();
    this._mesh.geometry.dispose();
    (this._mesh.material as { dispose(): void }).dispose();
    super.dispose();
  }

  private _moveCenter(dxKm: number, dzKm: number): void {
    const b = C.centerBounds;
    this.center.lon = MathUtils.clamp(this._projection.lon(dxKm), b.west, b.east);
    this.center.lat = MathUtils.clamp(this._projection.lat(dzKm), b.south, b.north);
    this._setView();
  }

  private _setView(): void {
    this._projection = new GeoProjection(this.center.lon, this.center.lat);
    this._bounds = this._projection.squareBounds(this.extentKm);
    this._level = levelFor(this.extentKm, this._segments || C.segments, C.maxZoom);
    this._range = null;
  }

  private _easeRange(dt: number): void {
    if (!this._mosaic) return;
    this._range ??= mosaicRange(this._mosaic.data, this._bounds);
    const k = 1 - Math.exp(-dt / RANGE_EASE_MS);
    this._floor += (this._range.min - this._floor) * k;
    this._relief += (this._range.max - this._range.min - this._relief) * k;
  }

  private _coarseLevel(): number {
    return Math.max(1, this._level - C.coarse.levels);
  }

  private _coarseReady(): boolean {
    const z = this._coarseLevel();
    return tilesCovering(z, this._bounds).every(({ x, y }) => this._cache.get(z, x, y));
  }

  /** Apercu large d'abord, puis le niveau affiche, chaque groupe du plus proche au plus loin. */
  private _request(): void {
    const coarse = this._coarseLevel();
    const areas: [number, GeoBounds][] = [
      [coarse, expandBounds(this._bounds, C.coarse.margin)],
      [this._level, expandBounds(this._bounds, C.margin)],
    ];
    const groups = areas.map(([z, area]) => ({ z, tiles: tilesCovering(z, area) }));
    const key = groups.map(({ z, tiles }) => `${z}:${tiles[0]!.x},${tiles[0]!.y}:${tiles.at(-1)!.x},${tiles.at(-1)!.y}`).join("|");
    if (key === this._requested) return;
    this._requested = key;

    const { lon, lat } = this.center;
    const cos = Math.cos(MathUtils.degToRad(lat));
    const distance = ({ z, x, y }: TileId) => {
      const b = tileBounds(z, x, y);
      return Math.hypot(((b.west + b.east) / 2 - lon) * cos, (b.north + b.south) / 2 - lat);
    };
    this._cache.request(
      groups.flatMap(({ z, tiles }) => tiles.map(({ x, y }) => ({ z, x, y })).sort((a, b) => distance(a) - distance(b)))
    );
  }

  private _compose(): void {
    const data = composeMosaic(this._cache, this._level, expandBounds(this._bounds, 0.05));
    this._mosaic = { data, level: this._level };
    this._range = null;
    this._tilesChanged = false;
    this._lastCompose = performance.now();

    const current = terrainSettings.heights.value as DataTexture;
    const { width, height } = current.image;
    if (width === data.width && height === data.height) {
      current.image.data = data.data;
      current.needsUpdate = true;
      return;
    }
    const next = new DataTexture(data.data, data.width, data.height, RedFormat, HalfFloatType);
    next.minFilter = LinearFilter;
    next.magFilter = LinearFilter;
    next.needsUpdate = true;
    terrainSettings.heights.value = next;
    current.dispose();
  }

  private _syncUniforms(): void {
    const s = terrainSettings;
    s.heightScale.value = this.heightScale;
    s.floor.value = this._floor;
    if (!this._mosaic) return;
    const m = this._mosaic.data;
    const { offset, scale } = mosaicUvTransform(this._bounds, m.bounds);
    s.uvOffset.value.set(...offset);
    s.uvScale.value.set(...scale);
    s.texel.value.set(1 / m.width / scale[0], 1 / m.height / scale[1]);
  }
}
