import { Object3DNodeBase } from "@_core/nodes/object3d/Object3DNode.base.ts";
import { TERRAIN_CONFIG } from "@graphics/config/terrain.config.ts";
import { createTerrainMaterial, terrainSettings } from "@graphics/materials/Terrain.material.ts";
import { NODE_ID } from "@graphics/nodes/Node.id.ts";
import { createBlockGeometry } from "@graphics/terrain/BlockGeometry.ts";
import type IElevationProvider from "@graphics/terrain/ElevationProvider.interface.ts";
import { GeoProjection, type GeoBounds, type SceneRect } from "@graphics/terrain/GeoProjection.ts";
import { fetchMosaic, mosaicHeightAt, type HeightMosaic } from "@graphics/terrain/HeightMosaic.ts";
import { DataTexture, DataUtils, HalfFloatType, LinearFilter, Mesh, RedFormat } from "three";

function heightTexture({ data, width, height }: HeightMosaic): DataTexture {
  const half = new Uint16Array(data.length);
  for (let i = 0; i < data.length; i++) half[i] = DataUtils.toHalfFloat(data[i]);
  const texture = new DataTexture(half, width, height, RedFormat, HalfFloatType);
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** Bloc de relief : une grille deplacee sur GPU par les altitudes IGN, chargees en direct. */
export class TerrainNode extends Object3DNodeBase {
  readonly projection: GeoProjection;
  readonly bounds: GeoBounds;
  readonly rect: SceneRect;
  readonly settings = { segments: TERRAIN_CONFIG.segments as number };
  private readonly _mesh: Mesh;
  private readonly _provider: IElevationProvider;
  private readonly _loading = new AbortController();
  private _mosaic: HeightMosaic | null = null;
  private _segments = 0;

  constructor(provider: IElevationProvider) {
    const mesh = new Mesh(undefined, createTerrainMaterial());
    super(NODE_ID.TERRAIN, "Terrain", mesh);
    const { lon, lat } = TERRAIN_CONFIG.center;
    this.projection = new GeoProjection(lon, lat);
    this.bounds = this.projection.squareBounds(TERRAIN_CONFIG.sizeKm);
    this.rect = this.projection.rect(this.bounds);
    this._mesh = mesh;
    this._provider = provider;
    mesh.position.set(this.rect.minX, 0, this.rect.minZ);
    mesh.scale.set(TERRAIN_CONFIG.sizeKm, 1, TERRAIN_CONFIG.sizeKm);
    terrainSettings.baseDepth.value = TERRAIN_CONFIG.baseDepthKm;
    this.applySettings();
  }

  /** Altitude affichee (km, exageration comprise). */
  heightAt(x: number, z: number): number {
    if (!this._mosaic) return 0;
    const meters = mosaicHeightAt(this._mosaic, this.projection.lon(x), this.projection.lat(z));
    return (meters * terrainSettings.exaggeration.value) / 1000;
  }

  applySettings(): void {
    if (this.settings.segments === this._segments) return;
    this._segments = this.settings.segments;
    this._mesh.geometry.dispose();
    this._mesh.geometry = createBlockGeometry(this._segments);
  }

  // Le premier niveau est attendu, les suivants affinent le bloc en arriere-plan.
  override async beforeMount(): Promise<void> {
    if (this._mosaic) return;
    const [first, ...rest] = TERRAIN_CONFIG.zooms;
    await this._load(first);
    void (async () => {
      for (const z of rest) await this._load(z);
    })().catch((error) => {
      if (!this._loading.signal.aborted) console.warn("[Terrain] affinage interrompu", error);
    });
  }

  override dispose(): void {
    this._loading.abort();
    this._mesh.geometry.dispose();
    (this._mesh.material as { dispose(): void }).dispose();
    terrainSettings.heights.value.dispose();
    super.dispose();
  }

  private async _load(z: number): Promise<void> {
    const mosaic = await fetchMosaic(this._provider, z, this.bounds, this._loading.signal);
    const { bounds: m, width, height } = mosaic;
    const spanLon = m.east - m.west;
    const spanLat = m.north - m.south;
    const b = this.bounds;
    const s = terrainSettings;

    s.uvOffset.value.set((b.west - m.west) / spanLon, (m.north - b.north) / spanLat);
    s.uvScale.value.set((b.east - b.west) / spanLon, (b.north - b.south) / spanLat);
    s.texelUv.value.set(1 / width, 1 / height);
    s.texelKm.value.set(
      this.projection.x(m.west + spanLon / width) - this.projection.x(m.west),
      this.projection.z(m.north - spanLat / height) - this.projection.z(m.north)
    );

    const previous = s.heights.value;
    s.heights.value = heightTexture(mosaic);
    previous.dispose();
    this._mosaic = mosaic;
  }
}
