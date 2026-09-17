import { Object3DNodeBase } from "@_core/nodes/object3d/Object3DNode.base.ts";
import { TERRAIN_CONFIG } from "@graphics/config/terrain.config.ts";
import { createTerrainMaterial, terrainSettings, type HeightLayerUniforms } from "@graphics/materials/Terrain.material.ts";
import { NODE_ID } from "@graphics/nodes/Node.id.ts";
import { createBlockGeometry } from "@graphics/terrain/BlockGeometry.ts";
import type IElevationProvider from "@graphics/terrain/ElevationProvider.interface.ts";
import {
  containsBounds,
  containsPoint,
  expandBounds,
  GeoProjection,
  type GeoBounds,
  type SceneRect,
} from "@graphics/terrain/GeoProjection.ts";
import { fetchMosaic, mosaicHeightAt, mosaicUvTransform, type HeightMosaic } from "@graphics/terrain/HeightMosaic.ts";
import { DataTexture, DataUtils, HalfFloatType, LinearFilter, MathUtils, Mesh, RedFormat } from "three";

interface Layer {
  zoom: number;
  margin: number;
  uniforms: HeightLayerUniforms;
  mosaic: HeightMosaic | null;
  loading: { area: GeoBounds; controller: AbortController } | null;
}

function heightTexture({ data, width, height }: HeightMosaic): DataTexture {
  const half = new Uint16Array(data.length);
  for (let i = 0; i < data.length; i++) half[i] = DataUtils.toHalfFloat(data[i]);
  const texture = new DataTexture(half, width, height, RedFormat, HalfFloatType);
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Bloc de relief fixe dans la scene. Glisser deplace le centre geographique :
 * le terrain defile dans le bloc, les altitudes IGN suivent en direct.
 */
export class TerrainNode extends Object3DNodeBase {
  readonly center: { lon: number; lat: number } = { ...TERRAIN_CONFIG.center };
  readonly rect: SceneRect;
  readonly settings = { segments: TERRAIN_CONFIG.segments as number };
  private readonly _mesh: Mesh;
  private readonly _provider: IElevationProvider;
  private readonly _layers: Layer[];
  private _projection = new GeoProjection(this.center.lon, this.center.lat);
  private _bounds = this._projection.squareBounds(TERRAIN_CONFIG.sizeKm);
  private _segments = 0;
  private _disposed = false;

  constructor(provider: IElevationProvider) {
    const mesh = new Mesh(undefined, createTerrainMaterial());
    super(NODE_ID.TERRAIN, "Terrain", mesh);
    const half = TERRAIN_CONFIG.sizeKm / 2;
    this.rect = { minX: -half, maxX: half, minZ: -half, maxZ: half };
    this._mesh = mesh;
    this._provider = provider;
    this._layers = [
      { ...TERRAIN_CONFIG.coarse, uniforms: terrainSettings.coarse, mosaic: null, loading: null },
      { ...TERRAIN_CONFIG.fine, uniforms: terrainSettings.fine, mosaic: null, loading: null },
    ];
    mesh.position.set(-half, 0, -half);
    mesh.scale.set(TERRAIN_CONFIG.sizeKm, 1, TERRAIN_CONFIG.sizeKm);
    terrainSettings.baseDepth.value = TERRAIN_CONFIG.baseDepthKm;
    terrainSettings.sizeKm.value = TERRAIN_CONFIG.sizeKm;
    this.applySettings();
  }

  /** Deplace le centre de (dx, dz) km, x vers l'est, z vers le sud. */
  moveBy(dxKm: number, dzKm: number): void {
    const b = TERRAIN_CONFIG.centerBounds;
    this.center.lon = MathUtils.clamp(this._projection.lon(dxKm), b.west, b.east);
    this.center.lat = MathUtils.clamp(this._projection.lat(dzKm), b.south, b.north);
    this._projection = new GeoProjection(this.center.lon, this.center.lat);
    this._bounds = this._projection.squareBounds(TERRAIN_CONFIG.sizeKm);
    this._syncLayers();
  }

  /** Altitude affichee (km, exageration comprise) au point (x, z) de la scene. */
  heightAt(x: number, z: number): number {
    const lon = this._projection.lon(x);
    const lat = this._projection.lat(z);
    const layer = [...this._layers].reverse().find((l) => l.mosaic && containsPoint(l.mosaic.bounds, lon, lat));
    if (!layer) return 0;
    return (mosaicHeightAt(layer.mosaic!, lon, lat) * terrainSettings.exaggeration.value) / 1000;
  }

  applySettings(): void {
    if (this.settings.segments === this._segments) return;
    this._segments = this.settings.segments;
    this._mesh.geometry.dispose();
    this._mesh.geometry = createBlockGeometry(this._segments);
  }

  // L'apercu est attendu : le bloc n'apparait pas a plat.
  override async beforeMount(): Promise<void> {
    if (!this._layers[0]!.mosaic) await this._load(this._layers[0]!);
  }

  override update(): void {
    for (const layer of this._layers) {
      const covered = layer.mosaic && containsBounds(layer.mosaic.bounds, this._bounds);
      const pending = layer.loading && containsBounds(layer.loading.area, this._bounds);
      if (covered || pending) continue;
      layer.loading?.controller.abort();
      void this._load(layer);
    }
  }

  override dispose(): void {
    this._disposed = true;
    for (const layer of this._layers) {
      layer.loading?.controller.abort();
      layer.uniforms.heights.value.dispose();
    }
    this._mesh.geometry.dispose();
    (this._mesh.material as { dispose(): void }).dispose();
    super.dispose();
  }

  private async _load(layer: Layer): Promise<void> {
    const loading = { area: expandBounds(this._bounds, layer.margin), controller: new AbortController() };
    layer.loading = loading;
    try {
      const mosaic = await fetchMosaic(this._provider, layer.zoom, loading.area, loading.controller.signal);
      if (this._disposed || loading.controller.signal.aborted) return;
      const previous = layer.uniforms.heights.value;
      layer.uniforms.heights.value = heightTexture(mosaic);
      previous.dispose();
      layer.mosaic = mosaic;
      this._syncLayers();
    } catch (error) {
      if (!loading.controller.signal.aborted) console.warn(`[Terrain] niveau ${layer.zoom} indisponible`, error);
    } finally {
      if (layer.loading === loading) layer.loading = null;
    }
  }

  private _syncLayers(): void {
    for (const { mosaic, uniforms } of this._layers) {
      if (!mosaic) continue;
      const { offset, scale } = mosaicUvTransform(this._bounds, mosaic.bounds);
      uniforms.uvOffset.value.set(...offset);
      uniforms.uvScale.value.set(...scale);
    }
    // Pas des normales : un texel de la couche la plus fine chargee.
    const finest = [...this._layers].reverse().find((l) => l.mosaic)?.mosaic;
    if (!finest) return;
    const b = this._bounds;
    const m = finest.bounds;
    terrainSettings.normalStep.value.set(
      (m.east - m.west) / finest.width / (b.east - b.west),
      (m.north - m.south) / finest.height / (b.north - b.south)
    );
  }
}
