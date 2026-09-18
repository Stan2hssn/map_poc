import { Object3DNodeBase } from "@_core/nodes/object3d/Object3DNode.base.ts";
import { BUILDINGS_CONFIG } from "@graphics/config/buildings.config.ts";
import { createRoofMaterial, createWallMaterial } from "@graphics/materials/Buildings.material.ts";
import { terrainSettings } from "@graphics/materials/Terrain.material.ts";
import { NODE_ID } from "@graphics/nodes/Node.id.ts";
import type { TerrainNode } from "@graphics/nodes/terrain/Terrain.node.ts";
import { expandBounds, type GeoBounds } from "@graphics/terrain/GeoProjection.ts";
import { mercatorTiles, tilePointToLonLat } from "@graphics/terrain/Landcover.ts";
import type { BuildingsTile } from "@graphics/terrain/Landcover.worker.ts";
import { BufferAttribute, BufferGeometry, Group, InstancedBufferAttribute, InstancedBufferGeometry, MathUtils, Mesh, Vector4 } from "three";
import type { MeshStandardNodeMaterial } from "three/webgpu";

const C = BUILDINGS_CONFIG;

/** Parallaxe dans le shader du sol, ou volumes extrudes par tuile. */
export type BuildingTechnique = "none" | "parallax" | "extrusion";

interface Tile {
  meshes: Mesh[];
  geo: GeoBounds;
  buildings: number;
  vertices: number;
  bytes: number;
  usedAt: number;
}

/**
 * Bati en relief sous `maxExtentKm` de largeur de vue. En parallaxe, il ne fait que regler le shader du sol ;
 * en extrusion, il place les volumes des tuiles visibles (construits par le worker du PLAN IGN) par uniformes,
 * sans jamais les reconstruire au mouvement.
 */
export class BuildingsNode extends Object3DNodeBase {
  readonly settings: { technique: BuildingTechnique; height: number } = { technique: "parallax", height: 1 };
  /** Ce qui est dessine en extrusion, pour le panneau de debug. */
  readonly stats = { buildings: 0, tiles: 0, vertices: 0, memoryMb: 0 };
  private readonly _group: Group;
  private readonly _terrain: TerrainNode;
  private readonly _tiles = new Map<string, Tile>();
  private readonly _roof = createRoofMaterial();
  private readonly _wall = createWallMaterial();
  private _wanted = "";
  private _frame = 0;
  private readonly _uv = new Vector4();

  constructor(terrain: TerrainNode) {
    const group = new Group();
    super(NODE_ID.BUILDINGS, "Buildings", group);
    this._group = group;
    this._terrain = terrain;
    terrain.landcover.onBuildings = (tile) => this._receive(tile);
  }

  override update(): void {
    this._frame++;
    const t = this._terrain;
    const { technique } = this.settings;
    const grow = technique === "none" ? 0 : 1 - MathUtils.smoothstep(t.extentKm, C.fullExtentKm, C.maxExtentKm);
    const s = terrainSettings;
    s.buildingGrow.value = grow;
    s.buildingUnits.value = (0.001 / t.kmPerUnit) * this.settings.height * grow;
    s.parallax.value = technique === "parallax" ? 1 : 0;
    t.withBuildingHeights = grow > 0;

    const extruded = technique === "extrusion" && grow > 0;
    this._group.visible = extruded;
    Object.assign(this.stats, { buildings: 0, tiles: 0, vertices: 0 });
    if (!extruded) return;

    const z = t.landcover.fineZoom;
    const wanted = mercatorTiles(z, expandBounds(t.bounds, C.margin)).map((tile) => ({ z, ...tile, key: `${z}/${tile.x}/${tile.y}` }));
    const signature = wanted.map((tile) => tile.key).join();
    if (signature !== this._wanted) {
      this._wanted = signature;
      t.landcover.requestBuildings(wanted.filter((tile) => !this._tiles.has(tile.key)).map(({ z, x, y }) => ({ z, x, y })));
    }

    const visible = new Set(wanted.map((tile) => tile.key));
    const b = t.bounds;
    const width = b.east - b.west;
    const depth = b.south - b.north;
    for (const [key, tile] of this._tiles) {
      const { geo } = tile;
      this._uv.set((geo.west - b.west) / width, (geo.north - b.north) / depth, (geo.east - geo.west) / width, (geo.south - geo.north) / depth);
      const shown = visible.has(key) && this._inMask(this._uv);
      for (const mesh of tile.meshes) {
        mesh.visible = shown;
        if (shown) (mesh.userData.tileUv as Vector4).copy(this._uv);
      }
      if (!shown) continue;
      tile.usedAt = this._frame;
      this.stats.tiles++;
      this.stats.buildings += tile.buildings;
      this.stats.vertices += tile.vertices;
    }
  }

  override dispose(): void {
    for (const key of [...this._tiles.keys()]) this._drop(key);
    this._roof.dispose();
    this._wall.dispose();
    super.dispose();
  }

  private _receive(message: BuildingsTile): void {
    const key = `${message.z}/${message.x}/${message.y}`;
    if (this._tiles.has(key)) return;
    const [west, north] = tilePointToLonLat(message.z, message, 0, 0, 1);
    const [east, south] = tilePointToLonLat(message.z, message, 1, 1, 1);
    const meshes: Mesh[] = [];
    const walls = message.wallEdges.length / 4;

    if (message.roofIndex.length) {
      const roofs = new BufferGeometry();
      roofs.setAttribute("point", new BufferAttribute(message.roofPoints, 2, true));
      roofs.setAttribute("building", new BufferAttribute(message.roofBuildings, 4, true));
      roofs.setIndex(new BufferAttribute(message.roofIndex, 1));
      meshes.push(this._mesh(roofs, this._roof));
    }
    if (walls) {
      const quads = new InstancedBufferGeometry();
      quads.setAttribute("position", new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]), 3));
      quads.setIndex([0, 1, 2, 0, 2, 3]);
      quads.setAttribute("edge", new InstancedBufferAttribute(message.wallEdges, 4, true));
      quads.setAttribute("building", new InstancedBufferAttribute(message.wallBuildings, 4, true));
      quads.instanceCount = walls;
      meshes.push(this._mesh(quads, this._wall));
    }

    const bytes = [message.roofPoints, message.roofBuildings, message.roofIndex, message.wallEdges, message.wallBuildings].reduce(
      (sum, array) => sum + array.byteLength,
      0
    );
    this._tiles.set(key, {
      meshes,
      geo: { west, east, north, south },
      buildings: message.buildings,
      vertices: message.roofPoints.length / 2 + walls * 4,
      bytes,
      usedAt: this._frame,
    });
    this._trim();
  }

  private _mesh(geometry: BufferGeometry, material: MeshStandardNodeMaterial): Mesh {
    const mesh = new Mesh(geometry, material);
    // Place par le shader : pas de transformation, pas de culling sur une boite fausse.
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.userData.tileUv = new Vector4();
    mesh.visible = false;
    this._group.add(mesh);
    return mesh;
  }

  /** Tuile (origine et taille en uv du bloc) touchant la zone dessinee, bord irregulier compris. */
  private _inMask(uv: Vector4): boolean {
    const s = terrainSettings;
    const block = s.blockSize.value;
    const center = s.maskCenter.value;
    const radius = s.maskRadius.value;
    const x0 = (uv.x - 0.5) * block.x;
    const z0 = (uv.y - 0.5) * block.y;
    const x = MathUtils.clamp(center.x, x0, x0 + uv.z * block.x);
    const z = MathUtils.clamp(center.y, z0, z0 + uv.w * block.y);
    return Math.hypot((x - center.x) / radius.x, (z - center.y) / radius.y) < 1 + s.maskJitter.value / 2;
  }

  /** Oublie les tuiles les moins recemment vues au-dela du plafond. */
  private _trim(): void {
    const excess = this._tiles.size - C.cacheTiles;
    if (excess > 0) {
      const oldest = [...this._tiles].sort(([, a], [, b]) => a.usedAt - b.usedAt).slice(0, excess);
      for (const [key] of oldest) this._drop(key);
    }
    let bytes = 0;
    for (const tile of this._tiles.values()) bytes += tile.bytes;
    this.stats.memoryMb = bytes / 1e6;
  }

  private _drop(key: string): void {
    for (const mesh of this._tiles.get(key)?.meshes ?? []) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
    }
    this._tiles.delete(key);
  }
}
