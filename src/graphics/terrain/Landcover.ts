import type { GeoBounds } from "./GeoProjection.ts";
import { GEOMETRY, partsOf, type VectorFeature, type VectorLayer } from "./VectorTile.ts";

/**
 * Texture de donnees du sol, facon Chartogne-Taillet : les couches du PLAN IGN (tuiles vectorielles
 * Web Mercator) dessinees dans une grille lon/lat alignee sur le relief.
 * R : bati, G : vegetation, B : eau, A : routes.
 */
export const landcoverUrl = (z: number, x: number, y: number) => `https://data.geopf.fr/tms/1.0.0/PLAN.IGN/${z}/${x}/${y}.pbf`;

/** Zoom maximal du PLAN IGN, et taille a laquelle une tuile est dessinee. */
const MAX_ZOOM = 16;
/** Au centre, deux niveaux plus fins : le PLAN IGN ne garde tout le bati qu'a partir du 14-15 ; au-dela de 15, rien de plus. */
const FOCUS_LEVELS = 2;
const MAX_FINE_ZOOM = 15;
/** Couches dessinees, et leurs attributs utiles : le worker ne decode rien d'autre. */
export const LANDCOVER_LAYERS = {
  bati_surf: ["hauteur"],
  ocs_vegetation_surf: ["symbo"],
  hydro_surf: [],
  hydro_reseau: [],
  routier_route: ["symbo", "sens_circu"],
  routier_route_sup: ["symbo", "sens_circu"],
  routier_chemin_sup: [],
  toponyme_hydro_lin: ["texte"],
  toponyme_routier_odonyme_lin: ["nom_desabrege"],
  routier_chemin: [],
  routier_surf: [],
} as const;
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
export const fineZoom = (z: number): number => Math.max(z, Math.min(MAX_FINE_ZOOM, z + FOCUS_LEVELS));

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

/** Largeur (m) d'une tuile, a sa latitude centrale. */
export function tileMeters(z: number, tile: TileXY): number {
  const [, lat] = tilePointToLonLat(z, tile, 0.5, 0.5, 1);
  return (EARTH_CIRCUMFERENCE_M * Math.cos(lat * RAD)) / 2 ** z;
}

/** y de la tuile (0 a `extent`) vers v lineaire en latitude (0 au nord, 1 au sud) : les volumes et le sol sont en lon/lat. */
export function latitudeV(z: number, tile: TileXY, extent: number): (y: number) => number {
  const n = 2 ** z;
  const latAt = (y: number) => Math.atan(Math.sinh(Math.PI * (1 - (2 * (tile.y + y / extent)) / n)));
  const north = latAt(0);
  const south = latAt(extent);
  return (y) => (north - latAt(y)) / (north - south);
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

/** Point d'une tuile (coordonnees 0 a `extent`) vers les pixels de l'image `canvas`. */
function tileToCanvas(z: number, tile: TileXY, canvas: Canvas): (px: number, py: number, extent: number) => [number, number] {
  const { bounds, width, height } = canvas;
  const sx = width / (bounds.east - bounds.west);
  const sy = height / (bounds.north - bounds.south);
  return (px, py, extent) => {
    const [lon, lat] = tilePointToLonLat(z, tile, px, py, extent);
    return [(lon - bounds.west) * sx, (bounds.north - lat) * sy];
  };
}

/** Trace le contour d'une entite de la tuile dans l'image `canvas`. */
export function tileTracer(z: number, tile: TileXY, canvas: Canvas): (pen: Pen, layer: VectorLayer, feature: VectorFeature) => void {
  const toCanvas = tileToCanvas(z, tile, canvas);
  return (pen, { coords, extent }, feature) => {
    pen.beginPath();
    let start = feature.start;
    for (const end of feature.ends) {
      for (let i = start; i < end; i += 2) {
        const [x, y] = toCanvas(coords[i]!, coords[i + 1]!, extent);
        if (i === start) pen.moveTo(x, y);
        else pen.lineTo(x, y);
      }
      start = end;
    }
  };
}

/** Largeur (m) d'une route selon sa classe (`symbo` du PLAN IGN). */
export const roadWidth = (feature: VectorFeature, fallback: number) => {
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
      trace(areas, layer, feature);
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
      trace(pen, layer, feature);
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
    trace(roads, surfaces!, feature);
    roads.fill("nonzero");
  }
  strokeLayer(roads, "routier_route", "#ffffff", (f) => roadWidth(f, 6));
  strokeLayer(roads, "routier_chemin", "#ffffff", () => PATH_WIDTH_M);
  // Routes sur ouvrage : les ponts, dessines par-dessus l'eau.
  strokeLayer(roads, "routier_route_sup", "#ffffff", (f) => roadWidth(f, 6));
  strokeLayer(roads, "routier_chemin_sup", "#ffffff", () => PATH_WIDTH_M);
}

/** Ce qu'il faut de plus pour ecrire : texte, et repere qu'on tourne. */
export interface TextPen extends Pen {
  font: string;
  fillText(text: string, x: number, y: number): void;
  strokeText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  rotate(angle: number): void;
}

/**
 * Noms le long des voies, comme sur un plan grave : grands axes (boulevards, avenues, quais...) et longues
 * rues, fleuves en italique ; capitales espacees. Hauteur des lettres en metres (elles grandissent avec le zoom),
 * ecrites seulement quand elles sont lisibles, une fois par tuile (au milieu de la partie qui y tombe).
 */
const NAMES = {
  major: /^(BOULEVARD|AVENUE|QUAI|COURS|PLACE|PORTE) /,
  skipped: /^(TUNNEL|PASSAGE|IMPASSE|VILLA|SENTIER|CITE|HAMEAU|COUR|ALLEE|SQUARE|PASSERELLE|ESCALIER)\b/,
  /** Hauteur des lettres (m) : grands axes, rues, fleuves ; rue retenue a partir de cette longueur (m). */
  majorM: 55,
  streetM: 38,
  riverM: 90,
  longStreetM: 700,
  /** Lisibles (px de l'image) : ni plus petites, ni plus grandes. */
  minPx: 6,
  maxPx: 22,
  /** Espace entre les lettres, en hauteurs. */
  tracking: 0.28,
} as const;

export function drawNames(pen: TextPen, halos: Pen, layers: Map<string, VectorLayer>, z: number, tile: TileXY, canvas: Canvas): void {
  const { bounds, width } = canvas;
  const metersPerPixel = ((bounds.east - bounds.west) * RAD * 6_378_137 * Math.cos(((bounds.north + bounds.south) / 2) * RAD)) / width;
  const toCanvas = tileToCanvas(z, tile, canvas);
  const place = (line: number[], text: string, meters: number, italic: boolean, minLengthM = 0) => {
    const px = meters / metersPerPixel;
    if (px < NAMES.minPx) return;
    const size = Math.min(px, NAMES.maxPx);
    pen.font = `${italic ? "italic " : ""}600 ${size}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
    pen.lineWidth = Math.max(1.6, size * 0.18);
    pen.lineJoin = "round";
    const letters = [...text];
    const widths = letters.map((letter) => pen.measureText(letter).width);
    const gap = size * NAMES.tracking;
    const textWidth = widths.reduce((sum, w) => sum + w, 0) + gap * (letters.length - 1);
    const points: [number, number][] = [];
    for (let i = 0; i < line.length; i += 2) points.push([line[i]!, line[i + 1]!]);
    const lengths = [0];
    for (let i = 1; i < points.length; i++)
      lengths.push(lengths[i - 1]! + Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]));
    const total = lengths.at(-1)!;
    if (total < textWidth * 1.15 || total * metersPerPixel < minLengthM) return;
    // Une fois : la tuile qui contient le milieu de la voie l'ecrit.
    const middle = pointAt(points, lengths, total / 2);
    const [mx, my] = toCanvas(0, 0, 1);
    const [nx, ny] = toCanvas(1, 1, 1);
    if (middle[0] < Math.min(mx, nx) || middle[0] >= Math.max(mx, nx) || middle[1] < Math.min(my, ny) || middle[1] >= Math.max(my, ny))
      return;
    // Bandeau de papier sous le texte (couche des routes) : il efface le bati sous les lettres, qui s'y lisent.
    halos.lineCap = "round";
    halos.lineJoin = "round";
    halos.lineWidth = size * 1.5;
    halos.beginPath();
    const from = (total - textWidth) / 2;
    for (let i = 0; i <= 12; i++) {
      const [hx, hy] = pointAt(points, lengths, from + (textWidth * i) / 12);
      if (i === 0) halos.moveTo(hx, hy);
      else halos.lineTo(hx, hy);
    }
    halos.stroke();

    // A l'endroit : de gauche a droite.
    const reversed = points.at(-1)![0] < points[0]![0];
    let along = from;
    letters.forEach((letter, i) => {
      const center = along + widths[i]! / 2;
      const at = reversed ? total - center : center;
      const [x, y] = pointAt(points, lengths, at);
      const [ax, ay] = pointAt(points, lengths, Math.max(0, at - 1));
      const [bx, by] = pointAt(points, lengths, Math.min(total, at + 1));
      pen.save();
      pen.translate(x, y);
      pen.rotate(Math.atan2(by - ay, bx - ax) + (reversed ? Math.PI : 0));
      pen.fillText(letter, -widths[i]! / 2, size * 0.36);
      pen.restore();
      along += widths[i]! + gap;
    });
  };

  pen.fillStyle = "#ff0000";
  // Troncons d'une meme voie, en pixels de l'image.
  const named = (layer: VectorLayer | undefined, of: (feature: VectorFeature) => string) => {
    const lines = new Map<string, number[][]>();
    for (const feature of layer?.features ?? []) {
      const name = of(feature);
      if (feature.type !== GEOMETRY.line || !name) continue;
      const parts = lines.get(name) ?? [];
      for (const part of partsOf(layer!, feature)) {
        const points: number[] = [];
        for (let i = 0; i < part.length; i += 2) points.push(...toCanvas(part[i]!, part[i + 1]!, layer!.extent));
        parts.push(points);
      }
      lines.set(name, parts);
    }
    return lines;
  };
  const write = (
    lines: Map<string, number[][]>,
    meters: (name: string) => number | null,
    italic: boolean,
    minLengthM: (name: string) => number,
  ) => {
    for (const [name, parts] of lines) {
      const size = meters(name);
      if (size === null) continue;
      for (const chain of joinLines(parts)) place(chain, name, size, italic, minLengthM(name));
    }
  };
  const streets = named(layers.get("toponyme_routier_odonyme_lin"), (f) => String(f.properties.nom_desabrege ?? ""));
  write(
    streets,
    (name) => (NAMES.skipped.test(name) ? null : NAMES.major.test(name) ? NAMES.majorM : NAMES.streetM),
    false,
    (name) => (NAMES.major.test(name) ? 0 : NAMES.longStreetM),
  );
  const rivers = named(layers.get("toponyme_hydro_lin"), (f) => String(f.properties.texte ?? "").toUpperCase());
  write(
    rivers,
    () => NAMES.riverM,
    true,
    () => 0,
  );
}

/** Troncons bout a bout recolles en polylignes, du plus long au plus court. */
function joinLines(parts: number[][]): number[][] {
  const key = (x: number, y: number) => `${Math.round(x)},${Math.round(y)}`;
  const ends = new Map<string, number[]>();
  parts.forEach((part, i) => {
    for (const k of [key(part[0]!, part[1]!), key(part.at(-2)!, part.at(-1)!)]) ends.set(k, [...(ends.get(k) ?? []), i]);
  });
  const used = new Set<number>();
  const chains: number[][] = [];
  parts.forEach((part, i) => {
    if (used.has(i)) return;
    used.add(i);
    const chain = [...part];
    // Prolonge par les deux bouts tant qu'un troncon y commence ou y finit.
    for (const forward of [true, false]) {
      for (;;) {
        const [x, y] = forward ? [chain.at(-2)!, chain.at(-1)!] : [chain[0]!, chain[1]!];
        const next = (ends.get(key(x, y)) ?? []).find((j) => !used.has(j));
        if (next === undefined) break;
        used.add(next);
        const piece = parts[next]!;
        const head = Math.hypot(piece[0]! - x, piece[1]! - y) < Math.hypot(piece.at(-2)! - x, piece.at(-1)! - y);
        const ordered = head ? piece : reversedLine(piece);
        if (forward) chain.push(...ordered.slice(2));
        else chain.unshift(...reversedLine(ordered).slice(0, -2));
      }
    }
    chains.push(chain);
  });
  return chains.sort((a, b) => b.length - a.length);
}

const reversedLine = (line: number[]): number[] => {
  const out: number[] = [];
  for (let i = line.length - 2; i >= 0; i -= 2) out.push(line[i]!, line[i + 1]!);
  return out;
};

/** Point a la distance `at` le long de la polyligne `points` (longueurs cumulees `lengths`). */
function pointAt(points: [number, number][], lengths: number[], at: number): [number, number] {
  let i = 1;
  while (i < lengths.length - 1 && lengths[i]! < at) i++;
  const span = lengths[i]! - lengths[i - 1]! || 1;
  const t = Math.min(1, Math.max(0, (at - lengths[i - 1]!) / span));
  const [a, b] = [points[i - 1]!, points[i]!];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}
