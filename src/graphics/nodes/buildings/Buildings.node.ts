import { Object3DNodeBase } from "@_core/nodes/object3d/Object3DNode.base.ts";
import { BUILDINGS_CONFIG } from "@graphics/config/buildings.config.ts";
import { createRoofMaterial, createWallMaterial } from "@graphics/materials/Buildings.material.ts";
import { terrainSettings } from "@graphics/materials/Terrain.material.ts";
import { BOAT, CAR, createVehicleMaterial } from "@graphics/materials/Traffic.material.ts";
import { createTreeMaterial } from "@graphics/materials/Trees.material.ts";
import { NODE_ID } from "@graphics/nodes/Node.id.ts";
import type { TerrainNode } from "@graphics/nodes/terrain/Terrain.node.ts";
import { expandBounds, type GeoBounds } from "@graphics/terrain/GeoProjection.ts";
import { mercatorTiles, tilePointToLonLat } from "@graphics/terrain/Landcover.ts";
import type { BuildingsTile } from "@graphics/terrain/Landcover.worker.ts";
import { Traffic } from "@graphics/terrain/Traffic.ts";
import { TREE_STRIDE } from "@graphics/terrain/Trees.ts";
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  MathUtils,
  Mesh,
  Vector4,
} from "three";
import type { MeshStandardNodeMaterial } from "three/webgpu";

const C = BUILDINGS_CONFIG;

/** Distance de l'origine au segment (a, b). */
function segmentDistance(ax: number, ay: number, bx: number, by: number): number {
  const [dx, dy] = [bx - ax, by - ay];
  const t = MathUtils.clamp(-(ax * dx + ay * dy) / Math.max(dx * dx + dy * dy, 1e-12), 0, 1);
  return Math.hypot(ax + dx * t, ay + dy * t);
}
/** Tuiles recues montees en volumes par image : une rafale d'arrivees ne fige pas l'image. */
const TILES_PER_FRAME = 2;
/** Duree de l'apparition d'une tuile (ms) : ses batiments montent et se dessinent. */
const RISE_MS = 1400;
/** Ses hauteurs arrivees dans la texture du sol, l'ombrage passe des faces du volume a la texture en ce temps (ms). */
const RASTER_MS = 700;
/** Images pendant lesquelles les exemplaires vides des materiaux sont rendus (voir `_warmUp`). */
const WARM_FRAMES = 30;

/** Houppier : icosaedre unitaire, 12 sommets (normales de sphere dans le shader). */
function crownGeometry(): BufferGeometry {
  const t = (1 + Math.sqrt(5)) / 2;
  const corners = [-1, t, 0, 1, t, 0, -1, -t, 0, 1, -t, 0, 0, -1, t, 0, 1, t, 0, -1, -t, 0, 1, -t, t, 0, -1, t, 0, 1, -t, 0, -1, -t, 0, 1];
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(
      Float32Array.from(corners, (v) => v / Math.hypot(1, t)),
      3,
    ),
  );
  geometry.setIndex([
    0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8, 3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3,
    8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1,
  ]);
  return geometry;
}

/** Murs : un quadrilatere par arete (`edges`), instancie. */
function wallGeometry(edges: Uint16Array, buildings: Uint16Array): InstancedBufferGeometry {
  const quads = new InstancedBufferGeometry();
  quads.setAttribute("position", new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]), 3));
  quads.setIndex([0, 1, 2, 0, 2, 3]);
  quads.setAttribute("edge", new InstancedBufferAttribute(edges, 4, true));
  quads.setAttribute("building", new InstancedBufferAttribute(buildings, 4, true));
  quads.instanceCount = edges.length / 4;
  return quads;
}

/** Instances d'une forme de base, a une tuile : copie de ses attributs (liberes avec la tuile). */
function instanced(base: BufferGeometry, name: string, attribute: InstancedBufferAttribute): InstancedBufferGeometry {
  const geometry = new InstancedBufferGeometry();
  for (const [key, value] of Object.entries(base.attributes)) geometry.setAttribute(key, (value as BufferAttribute).clone());
  geometry.setIndex(base.getIndex()!.clone());
  geometry.setAttribute(name, attribute);
  geometry.instanceCount = attribute.count;
  return geometry;
}

/** Volumes extrudes par tuile, ou rien (carte a plat). */
export type BuildingTechnique = "none" | "extrusion";

interface Tile {
  meshes: Mesh[];
  geo: GeoBounds;
  buildings: number;
  vertices: number;
  bytes: number;
  usedAt: number;
  /** Premiere image ou elle a ete montree (ms), pour son apparition. */
  shownAt: number | null;
  /** Arrivee de ses hauteurs dans la texture du sol (ms) ; null tant qu'elle ne les a pas. */
  rasterAt: number | null;
  /** Distance a la camera (unites de scene), pour dessiner du plus proche au plus loin. */
  distance: number;
  trees: number;
  /** Houppiers de la tuile (part montree reglable), s'il y en a. */
  crowns: Mesh | null;
  /** Voitures et bateaux, et leurs instances, mis a jour a chaque image ou la tuile est montree. */
  movers: { moving: Traffic; instances: InstancedBufferAttribute; mesh: Mesh; kind: "cars" | "boats" }[];
}

/**
 * Bati en relief sous `maxExtentKm` de largeur de vue. En parallaxe, il ne fait que regler le shader du sol ;
 * en extrusion, il place les volumes des tuiles visibles (construits par le worker du PLAN IGN) par uniformes,
 * sans jamais les reconstruire au mouvement.
 */
export class BuildingsNode extends Object3DNodeBase {
  readonly settings: { technique: BuildingTechnique; height: number; trees: number; cars: number; boats: number } = {
    technique: "extrusion",
    height: 1,
    trees: 0.7,
    cars: 0.8,
    boats: 1,
  };
  /** Ce qui est dessine en extrusion, pour le panneau de debug. */
  readonly stats = { buildings: 0, tiles: 0, vertices: 0, memoryMb: 0, trees: 0, cars: 0, boats: 0 };
  /** Rien a monter ni en train d'apparaitre. */
  settled = true;
  /** Des voitures ou des bateaux bougent a l'ecran : l'image n'est jamais tout a fait immobile. */
  lively = false;
  private readonly _group = new Group();
  private _warm: Group | null;
  private readonly _terrain: TerrainNode;
  private readonly _tiles = new Map<string, Tile>();
  private readonly _roof = createRoofMaterial();
  private readonly _wall = createWallMaterial();
  private readonly _tree = createTreeMaterial();
  private readonly _car = createVehicleMaterial(CAR);
  private readonly _boat = createVehicleMaterial(BOAT);
  private readonly _crown = crownGeometry();
  private readonly _box = new BoxGeometry(1, 1, 1);
  private _wanted = "";
  private _frame = 0;
  private readonly _arrivals: BuildingsTile[] = [];
  /** Tuiles dont les hauteurs sont dans la texture du sol. */
  private _raster: ReadonlySet<string> = new Set();
  private readonly _uv = new Vector4();

  constructor(terrain: TerrainNode) {
    const root = new Group();
    super(NODE_ID.BUILDINGS, "Buildings", root);
    this._warm = this._warmUp();
    root.add(this._group, this._warm);
    this._terrain = terrain;
    terrain.landcover.onBuildings = (tile) => this._arrivals.push(tile);
    terrain.landcover.onHeights = (keys) => this._onHeights(keys);
  }

  override update(_time: number, dt: number): void {
    this._frame++;
    if (this._warm && this._frame > WARM_FRAMES) {
      for (const mesh of this._warm.children as Mesh[]) mesh.geometry.dispose();
      this._warm.removeFromParent();
      this._warm = null;
    }
    const t = this._terrain;
    const { technique } = this.settings;
    const grow = technique === "none" ? 0 : 1 - MathUtils.smoothstep(t.extentKm, C.fullExtentKm, C.maxExtentKm);
    const s = terrainSettings;
    s.buildingGrow.value = grow;
    s.buildingUnits.value = (0.001 / t.kmPerUnit) * this.settings.height * grow;
    t.withBuildingHeights = grow > 0;

    const meshes = technique === "extrusion";
    const extruded = meshes && grow > 0;
    this._group.visible = extruded;
    Object.assign(this.stats, { buildings: 0, tiles: 0, vertices: 0, trees: 0, cars: 0, boats: 0 });
    this.settled = this._arrivals.length === 0;
    this.lively = false;
    for (const message of this._arrivals.splice(0, TILES_PER_FRAME)) this._receive(message);
    // En vol, les tuiles de l'arrivee (si son bati est en relief), pas celles des vues traversees.
    const d = t.destination;
    const arrival = d && d.extentKm < C.maxExtentKm ? d.bounds : null;
    if (!meshes || (!extruded && !arrival)) return;

    const tilesOf = (bounds: GeoBounds) => {
      const z = t.landcover.fineZoomOf(bounds);
      return mercatorTiles(z, expandBounds(bounds, C.margin)).map((tile) => ({ z, ...tile, key: `${z}/${tile.x}/${tile.y}` }));
    };
    const wanted = tilesOf(arrival ?? t.bounds);
    const signature = wanted.map((tile) => tile.key).join();
    if (signature !== this._wanted) {
      this._wanted = signature;
      t.landcover.requestBuildings(wanted.filter((tile) => !this._tiles.has(tile.key)).map(({ z, x, y }) => ({ z, x, y })));
    }

    // Montrees selon la vue affichee : au depart d'un vol, celles du depart.
    if (!extruded) return;
    const visible = new Set((arrival ? tilesOf(t.bounds) : wanted).map((tile) => tile.key));
    const now = performance.now();
    const eye = t.projectFrom?.().position;
    const shownTiles: Tile[] = [];
    const b = t.bounds;
    const width = b.east - b.west;
    const depth = b.south - b.north;
    for (const [key, tile] of this._tiles) {
      const { geo } = tile;
      this._uv.set(
        (geo.west - b.west) / width,
        (geo.north - b.north) / depth,
        (geo.east - geo.west) / width,
        (geo.south - geo.north) / depth,
      );
      const shown = visible.has(key) && this._inMask(this._uv);
      if (shown) tile.shownAt ??= now;
      const appear = tile.shownAt === null ? 0 : Math.min(1, (now - tile.shownAt) / RISE_MS);
      const raster = tile.rasterAt === null ? 0 : Math.min(1, (now - tile.rasterAt) / RASTER_MS);
      for (const mesh of tile.meshes) {
        mesh.visible = shown;
        mesh.userData.appear = appear;
        mesh.userData.raster = raster;
        if (shown) (mesh.userData.tileUv as Vector4).copy(this._uv);
      }
      if (!shown) continue;
      if (appear < 1 || (raster > 0 && raster < 1)) this.settled = false;
      shownTiles.push(tile);
      const [cx, cz] = [
        (this._uv.x + this._uv.z / 2 - 0.5) * s.blockSize.value.x,
        (this._uv.y + this._uv.w / 2 - 0.5) * s.blockSize.value.y,
      ];
      tile.distance = eye ? Math.hypot(cx - eye.x, cz - eye.z) : 0;
      tile.usedAt = this._frame;
      this.stats.tiles++;
      this.stats.buildings += tile.buildings;
      this.stats.vertices += tile.vertices;
      // Part montree : regler la densite ne redessine rien, il suffit d'en dessiner moins.
      const trees = Math.round(tile.trees * this.settings.trees);
      if (tile.crowns) (tile.crowns.geometry as InstancedBufferGeometry).instanceCount = trees;
      this.stats.trees += trees;
      for (const { moving, instances, mesh, kind } of tile.movers) {
        const count = Math.round(moving.count * this.settings[kind]);
        (mesh.geometry as InstancedBufferGeometry).instanceCount = count;
        if (!count) continue;
        moving.step(Math.min(dt, 100) / 1000);
        moving.write(instances.array as Float32Array);
        instances.needsUpdate = true;
        this.stats[kind] += count;
        this.lively = true;
      }
    }
    // Du plus proche au plus loin : le test de profondeur ecarte le bati cache avant son shader, couteux.
    shownTiles.sort((a, c) => a.distance - c.distance);
    shownTiles.forEach((tile, order) => {
      for (const mesh of tile.meshes) mesh.renderOrder = order;
    });
  }

  override dispose(): void {
    for (const key of [...this._tiles.keys()]) this._drop(key);
    for (const material of [this._roof, this._wall, this._tree, this._car, this._boat]) material.dispose();
    this._crown.dispose();
    this._box.dispose();
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
    if (walls) meshes.push(this._mesh(wallGeometry(message.wallEdges, message.wallBuildings), this._wall));

    const trees = message.trees.length / TREE_STRIDE;
    const crowns = trees
      ? this._mesh(instanced(this._crown, "tree", new InstancedBufferAttribute(message.trees, 4, true)), this._tree)
      : null;
    if (crowns) meshes.push(crowns);
    const movers: Tile["movers"] = [];
    for (const [kind, lanes, material] of [
      ["cars", message.roads, this._car],
      ["boats", message.boats, this._boat],
    ] as const) {
      const moving = new Traffic(lanes, message.x * 31 + message.y);
      if (!moving.count) continue;
      const instances = new InstancedBufferAttribute(new Float32Array(moving.count * 4), 4);
      instances.setUsage(DynamicDrawUsage);
      moving.write(instances.array as Float32Array);
      const mesh = this._mesh(instanced(this._box, "vehicle", instances), material);
      meshes.push(mesh);
      movers.push({ moving, instances, mesh, kind });
    }

    const bytes = [
      message.roofPoints,
      message.roofBuildings,
      message.roofIndex,
      message.wallEdges,
      message.wallBuildings,
      message.trees,
    ].reduce((sum, array) => sum + array.byteLength, 0);
    this._tiles.set(key, {
      meshes,
      geo: { west, east, north, south },
      buildings: message.buildings,
      vertices: message.roofPoints.length / 2 + walls * 4,
      bytes,
      usedAt: this._frame,
      shownAt: null,
      rasterAt: this._raster.has(key) ? performance.now() : null,
      distance: 0,
      trees,
      crowns,
      movers,
    });
    this._trim();
  }

  /**
   * Un exemplaire vide (sans surface) de chaque materiau, rendu les premieres images, bati montre ou non : leurs
   * shaders se compilent au demarrage plutot qu'a l'arrivee sur une ville, ou ils figeaient l'image (5 d'un coup,
   * 0,2 a 1,4 s).
   */
  private _warmUp(): Group {
    const group = new Group();
    const roofs = new BufferGeometry();
    roofs.setAttribute("point", new BufferAttribute(new Uint16Array(6), 2, true));
    roofs.setAttribute("building", new BufferAttribute(new Uint16Array(12), 4, true));
    roofs.setIndex(new BufferAttribute(new Uint32Array(3), 1));
    const vehicle = () => new InstancedBufferAttribute(new Float32Array(4), 4).setUsage(DynamicDrawUsage);
    for (const [geometry, material] of [
      [roofs, this._roof],
      [wallGeometry(new Uint16Array(4), new Uint16Array(4)), this._wall],
      [instanced(this._crown, "tree", new InstancedBufferAttribute(new Uint16Array(4), 4, true)), this._tree],
      [instanced(this._box, "vehicle", vehicle()), this._car],
      [instanced(this._box, "vehicle", vehicle()), this._boat],
    ] as const) {
      this._mesh(geometry, material, group).visible = true;
    }
    return group;
  }

  private _mesh(geometry: BufferGeometry, material: MeshStandardNodeMaterial, parent = this._group): Mesh {
    const mesh = new Mesh(geometry, material);
    // Place par le shader : pas de transformation, pas de culling sur une boite fausse.
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    // Ombres du bati lues dans la texture de hauteurs, comme en parallaxe : pas de passe d'ombre pour eux.
    mesh.receiveShadow = true;
    mesh.userData.tileUv = new Vector4();
    mesh.userData.appear = 0;
    mesh.userData.raster = 0;
    mesh.visible = false;
    parent.add(mesh);
    return mesh;
  }

  /**
   * Tuile (origine et taille en uv du bloc) touchant la zone dessinee, bord irregulier compris : son rectangle,
   * ramene dans les axes du masque (autour du point vise) et divise par ses rayons, doit toucher le disque unite.
   * Sans l'encre (carte de nuit), tout le bloc est montre.
   */
  private _inMask(uv: Vector4): boolean {
    const s = terrainSettings;
    if (s.pen.value < 0.5) return true;
    const block = s.blockSize.value;
    const axis = s.maskAxis.value;
    const grow = (1 + s.maskJitter.value / 2) * s.maskScale.value;
    const [rx, rz] = [s.maskRadius.value.x * grow, s.maskRadius.value.y * grow];
    const x0 = (uv.x - 0.5) * block.x;
    const z0 = (uv.y - 0.5) * block.y;
    const [x1, z1] = [x0 + uv.z * block.x, z0 + uv.w * block.y];
    const corners = [
      [x0, z0],
      [x1, z0],
      [x1, z1],
      [x0, z1],
    ].map(([x, z]) => [(x! * axis.y - z! * axis.x) / rx, (x! * axis.x + z! * axis.y) / rz] as const);
    let inside = true;
    let sign = 0;
    for (let i = 0; i < 4; i++) {
      const [ax, ay] = corners[i]!;
      const [bx, by] = corners[(i + 1) % 4]!;
      if (segmentDistance(ax, ay, bx, by) < 1) return true;
      const cross = Math.sign(ax * by - ay * bx);
      if (cross !== 0 && sign !== 0 && cross !== sign) inside = false;
      if (cross !== 0) sign = cross;
    }
    // Point vise dans la tuile.
    return inside;
  }

  /** Nouvelle texture de hauteurs : les tuiles qui y entrent passent a son ombrage, celles qui en sortent aux faces. */
  private _onHeights(keys: ReadonlySet<string>): void {
    const now = performance.now();
    this._raster = keys;
    for (const [key, tile] of this._tiles) tile.rasterAt = keys.has(key) ? (tile.rasterAt ?? now) : null;
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
