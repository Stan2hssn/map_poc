import { latitudeV, tileMeters, type TileXY } from "./Landcover.ts";
import { GEOMETRY, partsOf, surfaceContains, surfaceOf, type Surface, type VectorLayer } from "./VectorTile.ts";

/**
 * Arbres d'une tuile, le PLAN IGN n'en ayant pas un par un : semes dans ses zones de vegetation (parcs, bois,
 * forets, landes) sur une grille bousculee, clairsemes, jamais sur un batiment. Pas d'alignements le long des rues :
 * la carte reste un dessin, pas une maquette.
 * Par arbre : (u, v) dans la tuile (unorm16, v lineaire en latitude comme le bati), rayon du houppier (cm), forme
 * (0 feuillu, 1 conifere).
 */
export const TREE_STRIDE = 4;
/** Espacement (m) dans les bois ; au-dela de `MAX_TREES` par tuile, ils s'eclaircissent encore. */
const WOOD_SPACING_M = 15;
const MAX_TREES = 2400;
/**
 * Buissons : semes tres largement (m) partout ailleurs (ni bati, ni eau, ni bois), pour qu'un terrain vague ou une
 * emprise sans donnees ne reste pas une page blanche. Rayon (m).
 */
const BUSH_SPACING_M = 38;
const BUSH_M = [1.1, 2.3] as const;
/** Distance (m) qu'un buisson garde avec une route ou un chemin. */
const BUSH_CLEARANCE_M = 9;
/** Rayon du houppier (m), tire entre ces bornes. */
const CROWN_M = [2.5, 4.5] as const;
const CONIFERS = /CONI/;

/** Bruit deterministe dans [0, 1) : les memes arbres a chaque chargement. */
function hash(a: number, b: number, c: number): number {
  let h = Math.imul(a, 0x27d4eb2d) ^ Math.imul(b, 0x165667b1) ^ Math.imul(c, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Polygones d'une couche ranges par cellule de la tuile : un arbre n'en teste que quelques-uns. */
function polygonIndex(layer: VectorLayer | undefined, cells: number): (x: number, y: number) => boolean {
  const extent = layer?.extent ?? 4096;
  const grid: Surface[][] = Array.from({ length: cells * cells }, () => []);
  const cell = (v: number) => Math.min(cells - 1, Math.max(0, Math.floor((v / extent) * cells)));
  for (const feature of layer?.features ?? []) {
    if (feature.type !== GEOMETRY.polygon) continue;
    const area = surfaceOf(layer!, feature);
    for (let y = cell(area.minY); y <= cell(area.maxY); y++)
      for (let x = cell(area.minX); x <= cell(area.maxX); x++) grid[y * cells + x]!.push(area);
  }
  return (x, y) => grid[cell(y) * cells + cell(x)]!.some((area) => surfaceContains(area, x, y));
}

/**
 * Grille d'occupation de la tuile (une case = un peu moins de 10 m) : bati, eau, bois et abords des routes.
 * Les buissons ne se sement que dans les cases libres ; une seule passe sur les donnees, au lieu d'un test par
 * graine contre chaque polygone.
 */
function occupancy(layers: Map<string, VectorLayer>, extent: number, cells: number, road: number): Uint8Array {
  const grid = new Uint8Array(cells * cells);
  const cell = (v: number) => Math.min(cells - 1, Math.max(0, Math.floor((v / extent) * cells)));
  const mark = (cx: number, cy: number, spread: number) => {
    for (let y = Math.max(0, cy - spread); y <= Math.min(cells - 1, cy + spread); y++) {
      for (let x = Math.max(0, cx - spread); x <= Math.min(cells - 1, cx + spread); x++) grid[y * cells + x] = 1;
    }
  };
  const step = extent / cells;
  for (const name of ["bati_surf", "hydro_surf", "ocs_vegetation_surf"]) {
    const layer = layers.get(name);
    for (const feature of layer?.features ?? []) {
      if (feature.type !== GEOMETRY.polygon) continue;
      const area = surfaceOf(layer!, feature);
      for (let y = cell(area.minY); y <= cell(area.maxY); y++) {
        for (let x = cell(area.minX); x <= cell(area.maxX); x++) {
          if (!grid[y * cells + x] && surfaceContains(area, (x + 0.5) * step, (y + 0.5) * step)) grid[y * cells + x] = 1;
        }
      }
    }
  }
  // Routes : les cases traversees, elargies de la distance a garder (une case de plus : une graine peut se poser
  // au bord de la case libre voisine).
  const spread = Math.ceil(road / step) + 1;
  for (const name of ["routier_route", "routier_chemin"]) {
    const layer = layers.get(name);
    for (const feature of layer?.features ?? []) {
      if (feature.type !== GEOMETRY.line) continue;
      for (const line of partsOf(layer!, feature)) {
        for (let i = 2; i < line.length; i += 2) {
          const [ax, ay, bx, by] = [line[i - 2]!, line[i - 1]!, line[i]!, line[i + 1]!];
          const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
          for (let k = 0; k <= steps; k++) mark(cell(ax + ((bx - ax) * k) / steps), cell(ay + ((by - ay) * k) / steps), spread);
        }
      }
    }
  }
  return grid;
}

export function scatterTrees(layers: Map<string, VectorLayer>, z: number, tile: TileXY): Uint16Array {
  const vegetation = layers.get("ocs_vegetation_surf");
  const extent = vegetation?.extent ?? 4096;
  const perMeter = extent / tileMeters(z, tile);
  const v = latitudeV(z, tile, extent);
  const onBuilding = polygonIndex(layers.get("bati_surf"), 16);
  const out: number[] = [];
  const seed = tile.x * 7919 + tile.y;
  const limit = MAX_TREES * TREE_STRIDE;
  const plant = (x: number, y: number, n: number, conifer: boolean, size: readonly [number, number] = CROWN_M) => {
    if (x < 0 || y < 0 || x >= extent || y >= extent || out.length >= limit || onBuilding(x, y)) return;
    const crown = size[0] + (size[1] - size[0]) * hash(seed, n, 3);
    out.push(
      Math.round((x / extent) * 65535),
      Math.round(Math.min(1, Math.max(0, v(y))) * 65535),
      Math.round(crown * 100),
      conifer ? 1 : 0,
    );
  };

  // Bois : une graine par cellule de la grille, bousculee dans sa cellule ; plus espacees si la tuile deborderait.
  const woods = (vegetation?.features ?? [])
    .filter((f) => f.type === GEOMETRY.polygon)
    .map((f) => ({ area: surfaceOf(vegetation!, f), feature: f }));
  const sow = (step: number, visit: (x: number, y: number, n: number, conifer: boolean) => void) => {
    for (const { area, feature } of woods) {
      const conifer = CONIFERS.test(String(feature.properties.symbo ?? ""));
      for (let gy = Math.max(0, Math.floor(area.minY / step)); gy * step <= Math.min(extent, area.maxY); gy++) {
        for (let gx = Math.max(0, Math.floor(area.minX / step)); gx * step <= Math.min(extent, area.maxX); gx++) {
          const n = gy * 65536 + gx;
          const x = (gx + 0.1 + 0.8 * hash(seed, n, 1)) * step;
          const y = (gy + 0.1 + 0.8 * hash(seed, n, 2)) * step;
          if (surfaceContains(area, x, y)) visit(x, y, n, conifer);
        }
      }
    }
  };
  let step = WOOD_SPACING_M * perMeter;
  let seeds = 0;
  sow(step, () => seeds++);
  if (seeds > MAX_TREES) step *= Math.sqrt(seeds / MAX_TREES);
  sow(step, plant);

  // Buissons : la ou il n'y a ni bati, ni eau, ni bois, ni route, quelques touffes tiennent lieu de couvert.
  const bush = BUSH_SPACING_M * perMeter;
  const cells = 128;
  const taken = occupancy(layers, extent, cells, BUSH_CLEARANCE_M * perMeter);
  const free = (x: number, y: number) =>
    !taken[Math.min(cells - 1, Math.floor((y / extent) * cells)) * cells + Math.min(cells - 1, Math.floor((x / extent) * cells))];
  for (let gy = 0; gy * bush < extent; gy++) {
    for (let gx = 0; gx * bush < extent; gx++) {
      const n = 1e6 + gy * 65536 + gx;
      const x = (gx + 0.15 + 0.7 * hash(seed, n, 1)) * bush;
      const y = (gy + 0.15 + 0.7 * hash(seed, n, 2)) * bush;
      if (free(x, y)) plant(x, y, n, false, BUSH_M);
    }
  }
  return Uint16Array.from(out);
}
