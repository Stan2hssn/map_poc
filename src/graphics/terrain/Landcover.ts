import type { GeoBounds } from "./GeoProjection.ts";
import { GEOMETRY, type VectorFeature, type VectorLayer } from "./VectorTile.ts";

/**
 * Texture de donnees du sol, facon Chartogne-Taillet : les couches du PLAN IGN (tuiles vectorielles
 * Web Mercator) dessinees dans une grille lon/lat alignee sur le relief.
 * R : bati, G : vegetation, B : eau, A : routes.
 */
export const landcoverUrl = (z: number, x: number, y: number) => `https://data.geopf.fr/tms/1.0.0/PLAN.IGN/${z}/${x}/${y}.pbf`;

/** Zoom maximal du PLAN IGN, et taille a laquelle une tuile est dessinee. */
const MAX_ZOOM = 16;
/** Au centre, deux niveaux plus fins : le PLAN IGN ne garde tout le bati qu'a partir du 14-15. */
const FOCUS_LEVELS = 2;
const TILE_PX = 512;
const EARTH_CIRCUMFERENCE_M = 40_075_016.7;

/** Largeur des routes en metres selon leur classe ; jamais moins d'un demi-pixel. */
const ROAD_WIDTH_M: [RegExp, number][] = [
  [/^AUTOROU/, 26],
  [/^PRINCIPALE/, 18],
  [/^REGIONALE/, 13],
  [/^LOCALE/, 9],
  [/^NON_CLASSEE/, 6],
];
const PATH_WIDTH_M = 3;
const RIVER_WIDTH_M = 18;

export interface TileXY {
  x: number;
  y: number;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const RAD = Math.PI / 180;

/** Zoom Web Mercator dont une tuile dessinee a 512 px egale la resolution voulue. */
export function landcoverZoom(bounds: GeoBounds, widthPx: number): number {
  const lat = (bounds.north + bounds.south) / 2;
  const metersPerPixel = ((bounds.east - bounds.west) * RAD * 6_378_137 * Math.cos(lat * RAD)) / widthPx;
  const z = Math.round(Math.log2((EARTH_CIRCUMFERENCE_M * Math.cos(lat * RAD)) / (TILE_PX * metersPerPixel)));
  return clamp(z, 0, MAX_ZOOM);
}

/** Niveau fin, dessine sur la zone centrale par-dessus le niveau `z` d'ensemble. */
export const fineZoom = (z: number): number => Math.min(MAX_ZOOM, z + FOCUS_LEVELS);

const tileX = (lon: number, n: number) => ((lon + 180) / 360) * n;
const tileY = (lat: number, n: number) => ((1 - Math.log(Math.tan(lat * RAD) + 1 / Math.cos(lat * RAD)) / Math.PI) / 2) * n;

/** Tuiles Web Mercator couvrant `bounds`, du centre vers les bords. */
export function mercatorTiles(z: number, bounds: GeoBounds): TileXY[] {
  const n = 2 ** z;
  const lat = (v: number) => clamp(v, -85, 85);
  const x0 = clamp(Math.floor(tileX(bounds.west, n)), 0, n - 1);
  const x1 = clamp(Math.floor(tileX(bounds.east, n)), 0, n - 1);
  const y0 = clamp(Math.floor(tileY(lat(bounds.north), n)), 0, n - 1);
  const y1 = clamp(Math.floor(tileY(lat(bounds.south), n)), 0, n - 1);
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const tiles: TileXY[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) tiles.push({ x, y });
  return tiles.sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy));
}

/** Point d'une tuile (coordonnees 0 a `extent`) vers lon/lat. */
export function tilePointToLonLat(z: number, tile: TileXY, px: number, py: number, extent: number): [number, number] {
  const n = 2 ** z;
  const lon = ((tile.x + px / extent) / n) * 360 - 180;
  const lat = Math.atan(Math.sinh(Math.PI * (1 - (2 * (tile.y + py / extent)) / n))) / RAD;
  return [lon, lat];
}

/** Ce qu'il faut d'un contexte 2D : la meme interface pour `OffscreenCanvas` et les tests. */
export interface Pen {
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
  fill(rule?: CanvasFillRule): void;
  stroke(): void;
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  globalCompositeOperation: GlobalCompositeOperation;
}

export interface Canvas {
  bounds: GeoBounds;
  width: number;
  height: number;
}

/** Trace le contour d'une entite de la tuile dans l'image `canvas`. */
export function tileTracer(z: number, tile: TileXY, canvas: Canvas): (pen: Pen, feature: VectorFeature, extent: number) => void {
  const { bounds, width, height } = canvas;
  const sx = width / (bounds.east - bounds.west);
  const sy = height / (bounds.north - bounds.south);
  return (pen, feature, extent) => {
    pen.beginPath();
    for (const part of feature.geometry) {
      for (let i = 0; i < part.length; i += 2) {
        const [lon, lat] = tilePointToLonLat(z, tile, part[i]!, part[i + 1]!, extent);
        const x = (lon - bounds.west) * sx;
        const y = (bounds.north - lat) * sy;
        if (i === 0) pen.moveTo(x, y);
        else pen.lineTo(x, y);
      }
    }
  };
}

const roadWidth = (feature: VectorFeature, fallback: number) => {
  const symbo = String(feature.properties.symbo ?? "");
  return ROAD_WIDTH_M.find(([pattern]) => pattern.test(symbo))?.[1] ?? fallback;
};

/**
 * Dessine une tuile : bati, vegetation et eau sur `areas` (rouge, vert, bleu additionnes),
 * routes et chemins en blanc sur `roads`.
 */
export function drawLandcoverTile(areas: Pen, roads: Pen, layers: Map<string, VectorLayer>, z: number, tile: TileXY, canvas: Canvas): void {
  const { bounds, width } = canvas;
  const metersPerPixel = ((bounds.east - bounds.west) * RAD * 6_378_137 * Math.cos(((bounds.north + bounds.south) / 2) * RAD)) / width;
  const trace = tileTracer(z, tile, canvas);
  const fillLayer = (name: string, color: string) => {
    const layer = layers.get(name);
    if (!layer) return;
    areas.fillStyle = color;
    for (const feature of layer.features) {
      if (feature.type !== GEOMETRY.polygon) continue;
      trace(areas, feature, layer.extent);
      areas.fill("nonzero");
    }
  };
  const strokeLayer = (pen: Pen, name: string, color: string, widthM: (feature: VectorFeature) => number) => {
    const layer = layers.get(name);
    if (!layer) return;
    pen.strokeStyle = color;
    for (const feature of layer.features) {
      if (feature.type !== GEOMETRY.line) continue;
      pen.lineWidth = Math.max(0.5, widthM(feature) / metersPerPixel);
      trace(pen, feature, layer.extent);
      pen.stroke();
    }
  };

  areas.globalCompositeOperation = "lighter";
  fillLayer("ocs_vegetation_surf", "#00ff00");
  fillLayer("hydro_surf", "#0000ff");
  strokeLayer(areas, "hydro_reseau", "#0000ff", () => RIVER_WIDTH_M);
  fillLayer("bati_surf", "#ff0000");

  roads.globalCompositeOperation = "lighter";
  roads.lineCap = "round";
  roads.lineJoin = "round";
  roads.fillStyle = "#ffffff";
  const surfaces = layers.get("routier_surf");
  for (const feature of surfaces?.features ?? []) {
    if (feature.type !== GEOMETRY.polygon) continue;
    trace(roads, feature, surfaces!.extent);
    roads.fill("nonzero");
  }
  strokeLayer(roads, "routier_route", "#ffffff", (f) => roadWidth(f, 6));
  strokeLayer(roads, "routier_chemin", "#ffffff", () => PATH_WIDTH_M);
}

/** Deux images RGBA (surfaces, routes) vers une seule : routes dans l'alpha. */
export function packLandcover(areas: Uint8ClampedArray, roads: Uint8ClampedArray): Uint8Array {
  const out = new Uint8Array(areas.length);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = areas[i]!;
    out[i + 1] = areas[i + 1]!;
    out[i + 2] = areas[i + 2]!;
    out[i + 3] = roads[i]!;
  }
  return out;
}
