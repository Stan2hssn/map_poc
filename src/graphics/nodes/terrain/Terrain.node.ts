import { Object3DNodeBase } from "@_core/nodes/object3d/Object3DNode.base.ts";
import { TERRAIN_CONFIG } from "@graphics/config/terrain.config.ts";
import { createTerrainMaterial, terrainSettings } from "@graphics/materials/Terrain.material.ts";
import { NODE_ID } from "@graphics/nodes/Node.id.ts";
import type IElevationProvider from "@graphics/terrain/ElevationProvider.interface.ts";
import { GeoProjection, type SceneRect } from "@graphics/terrain/GeoProjection.ts";
import { fetchIgnContour, maskCovers, rasterizeMask, type MaskGrid } from "@graphics/terrain/TerrainMask.ts";
import { TILE_SIZE, type Tile } from "@graphics/terrain/Tile.ts";
import { createTileGeometry } from "@graphics/terrain/TileGeometry.ts";
import { TileTree } from "@graphics/terrain/TileTree.ts";
import { DataTexture, DataUtils, Group, HalfFloatType, LinearFilter, Mesh, RedFormat, Vector2, Vector3, type Camera } from "three";
import type { MeshStandardNodeMaterial } from "three/webgpu";

const geometry = createTileGeometry(TERRAIN_CONFIG.segments);
const SKIRT_RATIO = 0.05;

function toHalfFloat(data: Float32Array): Uint16Array {
  const out = new Uint16Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = DataUtils.toHalfFloat(data[i]);
  return out;
}

function linearTexture(texture: DataTexture): DataTexture {
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  // Lignes de largeur quelconque (masque R8) : sans cela, le repli WebGL2 les decale.
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
}

/** Relief du departement : tuiles IGN chargees et affinees selon la camera. */
export class TerrainNode extends Object3DNodeBase {
  readonly projection: GeoProjection;
  readonly rect: SceneRect;
  private readonly _group: Group;
  private readonly _provider: IElevationProvider;
  private readonly _camera: () => Camera;
  private readonly _meshes = new Map<Tile, Mesh>();
  private readonly _cameraPosition = new Vector3();
  private readonly _lastCamera = new Vector3(Infinity, 0, 0);
  private _tree: TileTree | null = null;
  private _maskTexture: DataTexture | null = null;
  private _dirty = true;

  constructor(provider: IElevationProvider, camera: () => Camera) {
    const group = new Group();
    super(NODE_ID.TERRAIN, "Terrain", group);
    const { west, east, south, north } = TERRAIN_CONFIG.bounds;
    this.projection = new GeoProjection((west + east) / 2, (south + north) / 2);
    this.rect = this.projection.rect(TERRAIN_CONFIG.bounds);
    this._group = group;
    this._provider = provider;
    this._camera = camera;
  }

  get tileCount(): number {
    return this._tree?.visibleCount ?? 0;
  }

  /** Altitude affichee (km, exageration comprise). */
  heightAt(x: number, z: number): number {
    return ((this._tree?.heightAt(x, z) ?? 0) * terrainSettings.exaggeration.value) / 1000;
  }

  override async beforeMount(): Promise<void> {
    if (this._tree) return;
    const mask = await this._loadMask();
    const { minX, minZ, maxX, maxZ } = this.rect;
    this._maskTexture = linearTexture(new DataTexture(mask.data, mask.width, mask.height, RedFormat));
    terrainSettings.mask.value = this._maskTexture;
    terrainSettings.maskOrigin.value.set(minX, minZ);
    terrainSettings.maskSize.value.set(maxX - minX, maxZ - minZ);

    this._tree = new TileTree(TERRAIN_CONFIG.bounds, this.projection, TERRAIN_CONFIG, {
      accept: (tile) => maskCovers(mask, tile.rect),
      load: (tile) => this._provider.fetchTile(tile.z, tile.x, tile.y, tile.controller.signal),
      loaded: () => {
        this._dirty = true;
      },
      setVisible: (tile, visible) => {
        if (visible) this._meshFor(tile).visible = true;
        else if (this._meshes.has(tile)) this._meshes.get(tile)!.visible = false;
      },
      release: (tile) => this._disposeMesh(tile),
    });
  }

  // Recalcul seulement quand la camera bouge ou qu'une tuile aboutit.
  override update(): void {
    if (!this._tree) return;
    this._camera().getWorldPosition(this._cameraPosition);
    if (!this._dirty && this._cameraPosition.distanceToSquared(this._lastCamera) < 1e-8) return;
    this._dirty = false;
    this._lastCamera.copy(this._cameraPosition);
    this._tree.update(this._cameraPosition);
  }

  override dispose(): void {
    this._tree?.dispose();
    this._maskTexture?.dispose();
    super.dispose();
  }

  private async _loadMask(): Promise<MaskGrid> {
    try {
      const contour = await fetchIgnContour(TERRAIN_CONFIG.departement);
      return rasterizeMask(contour, this.projection, this.rect, TERRAIN_CONFIG.maskSize);
    } catch (error) {
      console.warn("[Terrain] contour indisponible, rectangle complet", error);
      return { data: new Uint8Array([255]), width: 1, height: 1, rect: this.rect };
    }
  }

  private _meshFor(tile: Tile): Mesh {
    const existing = this._meshes.get(tile);
    if (existing) return existing;

    const { minX, minZ, maxX, maxZ } = tile.rect;
    const width = maxX - minX;
    const depth = maxZ - minZ;
    const heights = linearTexture(new DataTexture(toHalfFloat(tile.heights!), TILE_SIZE, TILE_SIZE, RedFormat, HalfFloatType));
    const material = createTerrainMaterial(heights, new Vector2(width / TILE_SIZE, depth / TILE_SIZE), tile.size * SKIRT_RATIO);
    const mesh = new Mesh(geometry, material);
    mesh.position.set(minX, 0, minZ);
    mesh.scale.set(width, 1, depth);
    mesh.userData.heights = heights;
    this._group.add(mesh);
    this._meshes.set(tile, mesh);
    return mesh;
  }

  private _disposeMesh(tile: Tile): void {
    const mesh = this._meshes.get(tile);
    if (!mesh) return;
    this._group.remove(mesh);
    (mesh.material as MeshStandardNodeMaterial).dispose();
    (mesh.userData.heights as DataTexture).dispose();
    this._meshes.delete(tile);
  }
}
