import { bridgeDecks, buildTileMesh, cellMaxima, drawBuildingHeights, PEAK_CELL, spreadPeaks, SUMMIT_CELL, sunShadow, type BuildingMesh } from "./Buildings.ts";
import { KM_PER_DEGREE, type GeoBounds } from "./GeoProjection.ts";
import {
  drawLandcoverTile,
  drawNames,
  fineZoom,
  LANDCOVER_LAYERS,
  landcoverUrl,
  landcoverZoom,
  mercatorTiles,
  tilePointToLonLat,
  type TileXY,
} from "./Landcover.ts";
import { boatLanes, roadLanes, type TileRoads } from "./Traffic.ts";
import { scatterTrees } from "./Trees.ts";
import { decodeVectorTile, vectorLayer, type VectorLayer } from "./VectorTile.ts";

export interface LandcoverRequest {
  kind: "landcover";
  id: number;
  bounds: GeoBounds;
  /** Zone ou le bati complet est dessine, par-dessus le niveau d'ensemble. */
  focus: GeoBounds;
  width: number;
  height: number;
  /** Dessiner aussi les hauteurs du bati sur `focus`, a la meme taille. */
  heights: boolean;
  /** Direction du soleil (vers lui ; x a l'est, y en haut, z au sud) : ombre du bati cuite avec les hauteurs. */
  sun: readonly [number, number, number];
}

export interface LandcoverImage extends LandcoverRequest {
  /** Surfaces (R bati, G vegetation, B eau) et routes (R) : images copiees telles quelles sur le GPU. */
  areas: ImageBitmap;
  roads: ImageBitmap;
  /**
   * Hauteurs du bati (m) sur `focus` et leurs sommets par cellule (`PEAK_CELL`) ; null si non demandees, ou pas
   * relues pour cette image partielle.
   */
  buildingHeights: Uint8Array | null;
  buildingPeaks: Uint8Array | null;
  /** Sommets des environs (`SUMMIT_CELL`, deux cellules alentour) : hauteur d'ou partir en parallaxe. */
  buildingSummits: Uint8Array | null;
  /** Ombre du bati (`sunShadow`) : hauteur (m) sous laquelle un point est a l'ombre. */
  buildingShade: Uint8Array | null;
  /** Tuiles (`z/x/y`) dont le bati est dans ces hauteurs ; null avec elles. */
  heightTiles: string[] | null;
  buildingMax: number;
  complete: boolean;
  /** Temps de dessin cumule de cette image dans le worker (ms). */
  renderMs: number;
}

export interface TileRef extends TileXY {
  z: number;
}

/** Tuiles dont les volumes manquent ; remplace la demande precedente. */
export interface BuildingsRequest {
  kind: "buildings";
  tiles: TileRef[];
}

/** Ce qui se pose sur une tuile : volumes du bati, arbres (`scatterTrees`), voies des voitures et des bateaux. */
export interface BuildingsTile extends TileRef, BuildingMesh {
  kind: "buildings";
  trees: Uint16Array;
  roads: TileRoads;
  boats: TileRoads;
}

/** Tuiles decodees gardees : plafond en octets (estimes), pas en nombre (une tuile de ville pese ~1,5 Mo). */
const MAX_TILE_BYTES = 96e6;
/** Estimation par entite : objet, proprietes et fins de parties. */
const FEATURE_BYTES = 120;
// data.geopf.fr sert en HTTP/2 : a 16 requetes a la fois, une vue arrive 2,5 a 3 fois plus vite qu'a 6.
const MAX_CONCURRENT = 16;
// Pendant le chargement, une image partielle part au plus a ce rythme ; ses hauteurs du bati, moins souvent.
const PARTIAL_MS = 300;
const HEIGHTS_MS = 600;
/**
 * Toiles dessinees en memoire, pas sur le GPU : un canvas accelere partage le GPU avec le rendu de la carte, et
 * ses gros lots de polygones y faisaient sauter des images a chaque redessin (mesure : 25 images de plus de
 * 10 ms en 5 s de zoom, aucune sans redessin).
 */
const CANVAS: CanvasRenderingContext2DSettings = { willReadFrequently: true };
/** Portee des ombres du bati (texels) : celle de l'ancienne marche, qui s'arretait aux sommets des cellules voisines. */
const SHADOW_REACH = PEAK_CELL * 1.5;
/**
 * Tuiles deja dessinees, gardees pour les images suivantes (plafond en octets) : un deplacement ou un retour en
 * arriere ne redessine que les tuiles nouvelles. Reprises telles quelles tant que leur taille a l'ecran change de
 * moins de `RASTER_SLACK` (sinon redessinees, pour ne pas flouter), avec `RASTER_MARGIN` px de bord : les tuiles
 * voisines se recouvrent, sans liseré a leur jointure.
 */
const MAX_RASTER_BYTES = 160e6;
const RASTER_SLACK = 0.15;
const RASTER_MARGIN = 2;

const scope = self as unknown as {
  onmessage: (event: MessageEvent<LandcoverRequest | BuildingsRequest>) => void;
  postMessage(message: LandcoverImage | BuildingsTile, transfer: Transferable[]): void;
};

/** Tuiles decodees (null : vide ou hors couverture), les plus anciennes oubliees. */
const tiles = new Map<string, Map<string, VectorLayer> | null>();
let tileBytes = 0;
/** Chargements en cours, et qui les attend encore. */
const loading = new Map<string, { promise: Promise<void>; wanted: (() => boolean)[] }>();
/** Telechargements en attente d'un creneau, par priorite (le plus petit d'abord). */
const waiting: { key: string; priority: number; start: () => void }[] = [];
let running = 0;
/**
 * Priorites : les volumes d'abord (ce qui se voit le plus), puis le niveau fin de l'image du sol, puis son niveau
 * d'ensemble ; dans chacun, du centre vers les bords (rang dans la demande). Sans elles, les tuiles de bati
 * attendaient derriere la centaine de tuiles de l'image du sol : des trous pendant plusieurs secondes.
 */
const PRIORITY = { buildings: 0, fine: 1000, coarse: 2000 } as const;
let latest: LandcoverRequest | null = null;
let buildingsWanted = new Set<string>();

const keyOf = (z: number, tile: TileXY) => `${z}/${tile.x}/${tile.y}`;

scope.onmessage = ({ data }) => {
  if (data.kind === "buildings") {
    buildingsWanted = new Set(data.tiles.map((t) => keyOf(t.z, t)));
    data.tiles.forEach((tile, index) => void sendBuildings(tile, PRIORITY.buildings + index));
    return;
  }
  latest = data;
  void compose(data);
};

interface Level {
  z: number;
  tiles: TileXY[];
}

type Pen2D = OffscreenCanvasRenderingContext2D;

/** Surfaces (bati, vegetation, eau) et routes d'un niveau, dessinees tuile par tuile. */
interface Pens {
  areas: Pen2D;
  roads: Pen2D;
}

/**
 * Image en cours : chaque tuile y est posee une fois, a son arrivee, sur la toile de son niveau (depuis son
 * dessin garde, `rasterOf`). Le niveau d'ensemble a un fond noir opaque ; le niveau fin est transparent hors de
 * ses tuiles, et le recouvre a l'assemblage. Plus besoin de tout redessiner a chaque image partielle.
 */
interface Composition {
  request: LandcoverRequest;
  coarse: Pens;
  fine: Pens;
  heights: Pen2D | null;
  heightTiles: string[];
  /** Derniere relecture des hauteurs (ms). */
  heightsAt: number;
  buildingMax: number;
  drawMs: number;
}

function pen(width: number, height: number, opaque: boolean): Pen2D {
  const pen = new OffscreenCanvas(width, height).getContext("2d", CANVAS)!;
  if (opaque) {
    pen.fillStyle = "#000000";
    pen.fillRect(0, 0, width, height);
  }
  return pen;
}

function pens(width: number, height: number, opaque: boolean): Pens {
  return { areas: pen(width, height, opaque), roads: pen(width, height, opaque) };
}

async function compose(request: LandcoverRequest): Promise<void> {
  const { width, height } = request;
  const z = landcoverZoom(request.bounds, width);
  const fine = fineZoom(z);
  const levels: Level[] = [{ z, tiles: centerFirst(z, mercatorTiles(z, request.bounds), request.focus) }];
  if (fine > z) levels.push({ z: fine, tiles: centerFirst(fine, mercatorTiles(fine, request.focus), request.focus) });
  const composition: Composition = {
    request,
    coarse: pens(width, height, true),
    fine: pens(width, height, false),
    heights: request.heights ? pen(width, height, true) : null,
    heightTiles: [],
    heightsAt: -Infinity,
    buildingMax: 0,
    drawMs: 0,
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const partial = () => {
    timer ??= setTimeout(() => {
      timer = undefined;
      post(composition, false);
    }, PARTIAL_MS);
  };
  // Une demande plus recente a remplace celle-ci : inutile de telecharger ni de dessiner pour elle.
  const current = () => latest === request;
  await Promise.all(
    levels.flatMap(({ z, tiles }, level) =>
      tiles.map(async (tile, index) => {
        const withHeights = level === levels.length - 1;
        // Deja dessinee a la bonne taille : rien a telecharger, meme si ses donnees ont ete oubliees.
        const priority = (level > 0 ? PRIORITY.fine : PRIORITY.coarse) + index;
        if (!reusable(composition, z, tile, withHeights)) await load(z, tile, current, priority);
        if (!draw(composition, z, tile, level > 0, withHeights)) {
          await load(z, tile, current, priority);
          draw(composition, z, tile, level > 0, withHeights);
        }
        partial();
      })
    )
  );
  clearTimeout(timer);
  post(composition, true);
}

/** Tuiles du centre de `around` vers ses bords : la ou l'on regarde arrive d'abord (la file est dans cet ordre). */
function centerFirst(z: number, list: TileXY[], around: GeoBounds): TileXY[] {
  const lon = (around.west + around.east) / 2;
  const lat = (around.north + around.south) / 2;
  const cos = Math.cos((lat * Math.PI) / 180);
  const distance = (tile: TileXY) => {
    const [x, y] = tilePointToLonLat(z, tile, 0.5, 0.5, 1);
    return Math.hypot((x - lon) * cos, y - lat);
  };
  return list.map((tile) => ({ tile, d: distance(tile) })).sort((a, b) => a.d - b.d).map(({ tile }) => tile);
}

/** Pose la tuile sur l'image ; faux s'il faut d'abord ses donnees (dessin a faire, donnees oubliees). */
function draw(c: Composition, z: number, tile: TileXY, fine: boolean, heights: boolean): boolean {
  if (latest !== c.request) return true;
  const started = performance.now();
  const { bounds, width, height, focus } = c.request;
  const withHeights = heights && !!c.heights;
  const raster = rasterOf(z, tile, placement(z, tile, { bounds, width, height }), withHeights ? placement(z, tile, { bounds: focus, width, height }) : null);
  if (!raster) return false;
  const pens = fine ? c.fine : c.coarse;
  // Fond opaque sur la tuile : au niveau fin, elle recouvrira le niveau d'ensemble.
  put(pens.areas, raster.areas, raster.at);
  put(pens.roads, raster.roads, raster.at);
  if (withHeights && raster.heights) {
    put(c.heights!, raster.heights.canvas, raster.heights.at);
    c.buildingMax = Math.max(c.buildingMax, raster.heights.max);
    c.heightTiles.push(keyOf(z, tile));
  }
  c.drawMs += performance.now() - started;
  return true;
}

/** Place d'une tuile dans une image (px, peut deborder) : coin, et taille. */
interface Placement {
  x: number;
  y: number;
  width: number;
  height: number;
}

function placement(z: number, tile: TileXY, { bounds, width, height }: { bounds: GeoBounds; width: number; height: number }): Placement {
  const [west, north] = tilePointToLonLat(z, tile, 0, 0, 1);
  const [east, south] = tilePointToLonLat(z, tile, 1, 1, 1);
  const sx = width / (bounds.east - bounds.west);
  const sy = height / (bounds.north - bounds.south);
  return { x: (west - bounds.west) * sx, y: (bounds.north - north) * sy, width: (east - west) * sx, height: (north - south) * sy };
}

/** Dessin d'une tuile garde : surfaces et routes, et ses hauteurs du bati (sur la zone fine). */
interface TileRaster {
  areas: OffscreenCanvas;
  roads: OffscreenCanvas;
  heights: { canvas: OffscreenCanvas; max: number } | null;
  bytes: number;
}

/** Dessins gardes, du plus anciennement servi au plus recent. */
const rasters = new Map<string, TileRaster>();
let rasterBytes = 0;

/**
 * Dessin garde d'une tuile, s'il convient aux places voulues (hauteurs comprises si `heights`) ; passe en fin de
 * file : il ne sera pas oublie avant d'etre pose.
 */
function reusable(c: Composition, z: number, tile: TileXY, heights: boolean): TileRaster | null {
  const { bounds, focus, width, height } = c.request;
  const key = keyOf(z, tile);
  const raster = rasters.get(key);
  if (!raster || !fits(raster.areas, placement(z, tile, { bounds, width, height }))) return null;
  if (heights && c.heights && !(raster.heights && fits(raster.heights.canvas, placement(z, tile, { bounds: focus, width, height })))) return null;
  rasters.delete(key);
  rasters.set(key, raster);
  return raster;
}

/** Une toile dessinee pour une tuile convient a cette place : meme taille, a `RASTER_SLACK` pres. */
function fits(canvas: OffscreenCanvas, at: Placement): boolean {
  const close = (drawn: number, wanted: number) => Math.abs(drawn - 2 * RASTER_MARGIN - wanted) <= wanted * RASTER_SLACK;
  return close(canvas.width, at.width) && close(canvas.height, at.height);
}

/**
 * Dessin de la tuile pour ces places, repris ou fait (il faut alors ses donnees) ; `heights` : place de ses
 * hauteurs, s'il les faut. Rend aussi ou le poser.
 */
function rasterOf(
  z: number,
  tile: TileXY,
  at: Placement,
  heightsAt: Placement | null
): (TileRaster & { at: Placement; heights: (TileRaster["heights"] & { at: Placement }) | null }) | null {
  const key = keyOf(z, tile);
  let raster = rasters.get(key);
  const layers = tiles.get(key);
  const areasOk = !!raster && fits(raster.areas, at);
  const heightsOk = !heightsAt || (!!raster?.heights && fits(raster.heights.canvas, heightsAt));
  if (!areasOk || !heightsOk) {
    if (!layers) return null;
    const kept = raster;
    const areas = areasOk ? { areas: kept!.areas, roads: kept!.roads } : paint(layers, z, tile, at);
    const heights = heightsOk ? (kept?.heights ?? null) : paintHeights(layers, z, tile, heightsAt!);
    if (kept) rasterBytes -= kept.bytes;
    const bytes = [areas.areas, areas.roads, heights?.canvas].reduce((sum, canvas) => sum + (canvas ? canvas.width * canvas.height * 4 : 0), 0);
    raster = { ...areas, heights, bytes };
    rasterBytes += bytes;
  }
  // Plus recemment servi : en fin de file.
  rasters.delete(key);
  rasters.set(key, raster!);
  for (const [old, dropped] of rasters) {
    if (rasterBytes <= MAX_RASTER_BYTES || old === key) break;
    rasters.delete(old);
    rasterBytes -= dropped.bytes;
  }
  const r = raster!;
  return { ...r, at, heights: r.heights && heightsAt ? { ...r.heights, at: heightsAt } : null };
}

/** Toile de la tuile a sa taille a l'ecran, bord compris, et ce qu'elle couvre (le cadre ou tracer). */
function frame(z: number, tile: TileXY, at: Placement): { width: number; height: number; bounds: GeoBounds } {
  const width = Math.max(1, Math.round(at.width)) + 2 * RASTER_MARGIN;
  const height = Math.max(1, Math.round(at.height)) + 2 * RASTER_MARGIN;
  const [west, north] = tilePointToLonLat(z, tile, 0, 0, 1);
  const [east, south] = tilePointToLonLat(z, tile, 1, 1, 1);
  const mx = ((east - west) / (width - 2 * RASTER_MARGIN)) * RASTER_MARGIN;
  const my = ((north - south) / (height - 2 * RASTER_MARGIN)) * RASTER_MARGIN;
  return { width, height, bounds: { west: west - mx, east: east + mx, north: north + my, south: south - my } };
}

function paint(layers: Map<string, VectorLayer>, z: number, tile: TileXY, at: Placement): { areas: OffscreenCanvas; roads: OffscreenCanvas } {
  const canvas = frame(z, tile, at);
  const [areas, roads] = [pen(canvas.width, canvas.height, true), pen(canvas.width, canvas.height, true)];
  drawLandcoverTile(areas, roads, layers, z, tile, canvas);
  drawNames(areas, roads, layers, z, tile, canvas);
  return { areas: areas.canvas, roads: roads.canvas };
}

function paintHeights(layers: Map<string, VectorLayer>, z: number, tile: TileXY, at: Placement): { canvas: OffscreenCanvas; max: number } {
  const canvas = frame(z, tile, at);
  const heights = pen(canvas.width, canvas.height, true);
  const max = drawBuildingHeights(heights, layers, z, tile, canvas);
  return { canvas: heights.canvas, max };
}

/** Pose un dessin de tuile a sa place, bord compris : il recouvre celui des voisines sur `RASTER_MARGIN` px. */
function put(into: Pen2D, canvas: OffscreenCanvas, at: Placement): void {
  const kx = at.width / (canvas.width - 2 * RASTER_MARGIN);
  const ky = at.height / (canvas.height - 2 * RASTER_MARGIN);
  into.globalCompositeOperation = "source-over";
  into.drawImage(canvas, at.x - RASTER_MARGIN * kx, at.y - RASTER_MARGIN * ky, canvas.width * kx, canvas.height * ky);
}

const assemblies: Partial<Record<keyof Pens, Pen2D>> = {};

/**
 * Niveau fin par-dessus le niveau d'ensemble, en image : elle part au thread principal puis au GPU sans jamais
 * etre relue en pixels (la relecture coutait l'essentiel de chaque envoi).
 */
function assemble(c: Composition, layer: keyof Pens): ImageBitmap {
  const { width, height } = c.request;
  let into = assemblies[layer];
  if (!into || into.canvas.width !== width || into.canvas.height !== height) {
    into = assemblies[layer] = new OffscreenCanvas(width, height).getContext("2d", CANVAS)!;
  }
  into.drawImage(c.coarse[layer].canvas, 0, 0);
  into.drawImage(c.fine[layer].canvas, 0, 0);
  return into.canvas.transferToImageBitmap();
}

function post(c: Composition, complete: boolean): void {
  if (latest !== c.request) return;
  const started = performance.now();
  const { width, height } = c.request;
  const areas = assemble(c, "areas");
  const roads = assemble(c, "roads");
  const transfer: Transferable[] = [areas, roads];

  let buildingHeights: Uint8Array | null = null;
  let buildingPeaks: Uint8Array | null = null;
  let buildingSummits: Uint8Array | null = null;
  let buildingShade: Uint8Array | null = null;
  let heightTiles: string[] | null = null;
  // Relire les hauteurs (depuis le GPU) coute : pendant le chargement, pas a chaque image partielle.
  if (c.heights && (complete || started - c.heightsAt >= HEIGHTS_MS)) {
    c.heightsAt = started;
    const rgba = c.heights.getImageData(0, 0, width, height).data;
    buildingHeights = new Uint8Array(width * height);
    for (let i = 0; i < buildingHeights.length; i++) buildingHeights[i] = rgba[i * 4]!;
    // Sommets des environs tires des sommets par cellule, pas des texels : une passe pleine resolution de moins.
    const cells = cellMaxima(buildingHeights, width, height, PEAK_CELL);
    const [w, h] = [Math.ceil(width / PEAK_CELL), Math.ceil(height / PEAK_CELL)];
    buildingPeaks = spreadPeaks(cells, w, h, 1);
    const k = SUMMIT_CELL / PEAK_CELL;
    buildingSummits = spreadPeaks(cellMaxima(cells, w, h, k), Math.ceil(w / k), Math.ceil(h / k), 2);
    buildingShade = shadeOf(buildingHeights, c.request);
    heightTiles = [...c.heightTiles];
    transfer.push(buildingHeights.buffer, buildingPeaks.buffer, buildingSummits.buffer, buildingShade.buffer);
  }
  const renderMs = c.drawMs + performance.now() - started;
  scope.postMessage(
    { ...c.request, areas, roads, buildingHeights, buildingPeaks, buildingSummits, buildingShade, heightTiles, buildingMax: c.buildingMax, complete, renderMs },
    transfer
  );
}

/** Ombre du bati sur `focus` : taille d'un texel au sol, direction du soleil en texels (x a l'est, y au sud). */
function shadeOf(heights: Uint8Array, { focus, width, height, sun }: LandcoverRequest): Uint8Array {
  const cos = Math.cos((((focus.north + focus.south) / 2) * Math.PI) / 180);
  const meters = [((focus.east - focus.west) * cos * KM_PER_DEGREE * 1000) / width, ((focus.north - focus.south) * KM_PER_DEGREE * 1000) / height] as const;
  const [x, y, z] = sun;
  const flat = Math.hypot(x, z);
  if (y <= 0.05 || flat < 1e-6) return new Uint8Array(width * height);
  return sunShadow(heights, width, height, [x / meters[0], z / meters[1]], y / flat, meters, SHADOW_REACH);
}

async function sendBuildings(tile: TileRef, priority: number): Promise<void> {
  const key = keyOf(tile.z, tile);
  const wanted = () => buildingsWanted.has(key);
  await load(tile.z, tile, wanted, priority);
  if (!wanted()) return;
  const layers = tiles.get(key);
  // Passee pendant qu'aucune demande ne la voulait : elle l'est de nouveau.
  if (layers === undefined) return sendBuildings(tile, priority);
  buildingsWanted.delete(key);
  const layer = layers?.get("bati_surf");
  const mesh = buildTileMesh(layer ?? vectorLayer(4096, []), tile.z, tile, layers ? bridgeDecks(layers, tile.z, tile) : []);
  const trees = layers ? scatterTrees(layers, tile.z, tile) : new Uint16Array(0);
  const roads = roadLanes(layers ?? new Map(), tile.z, tile);
  const boats = boatLanes(layers ?? new Map(), tile.z, tile);
  const message: BuildingsTile = { kind: "buildings", z: tile.z, x: tile.x, y: tile.y, ...mesh, trees, roads, boats };
  scope.postMessage(message, [
    mesh.roofPoints.buffer,
    mesh.roofBuildings.buffer,
    mesh.roofIndex.buffer,
    mesh.wallEdges.buffer,
    mesh.wallBuildings.buffer,
    trees.buffer,
    roads.points.buffer,
    roads.lanes.buffer,
    boats.points.buffer,
    boats.lanes.buffer,
  ]);
}

function load(z: number, tile: TileXY, wanted: () => boolean, priority: number): Promise<void> {
  const key = keyOf(z, tile);
  if (tiles.has(key)) return Promise.resolve();
  const pending = loading.get(key);
  if (pending) {
    pending.wanted.push(wanted);
    // Encore en file : une demande plus pressee la fait avancer.
    const queued = waiting.find((w) => w.key === key);
    if (queued && priority < queued.priority) {
      queued.priority = priority;
      waiting.sort((a, b) => a.priority - b.priority);
    }
    return pending.promise;
  }
  const entry = { promise: Promise.resolve(), wanted: [wanted] };
  entry.promise = slot(key, priority)
    .then(async () => {
      if (!entry.wanted.some((w) => w())) return;
      const response = await fetch(landcoverUrl(z, tile.x, tile.y));
      const layers = response.ok && response.status !== 204 ? decodeVectorTile(await response.arrayBuffer(), LANDCOVER_LAYERS) : null;
      tiles.set(key, layers);
      tileBytes += bytesOf(layers);
      for (const [old, dropped] of tiles) {
        if (tileBytes <= MAX_TILE_BYTES || old === key) break;
        tiles.delete(old);
        tileBytes -= bytesOf(dropped);
      }
    })
    .catch(() => {
      tiles.set(key, null);
    })
    .finally(() => {
      loading.delete(key);
      running--;
      waiting.shift()?.start();
    });
  loading.set(key, entry);
  return entry.promise;
}

function bytesOf(layers: Map<string, VectorLayer> | null | undefined): number {
  let bytes = 0;
  for (const layer of layers?.values() ?? []) bytes += layer.coords.byteLength + layer.features.length * FEATURE_BYTES;
  return bytes;
}

function slot(key: string, priority: number): Promise<void> {
  if (running < MAX_CONCURRENT) {
    running++;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const at = waiting.findIndex((w) => w.priority > priority);
    const entry = { key, priority, start: () => (running++, resolve()) };
    if (at < 0) waiting.push(entry);
    else waiting.splice(at, 0, entry);
  });
}
