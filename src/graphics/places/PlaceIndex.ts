import { ringsBounds, ringsContain } from "./Rings.ts";
import type { GeoBounds } from "@graphics/terrain/GeoProjection.ts";

export interface Place {
  name: string;
  lon: number;
  lat: number;
  population: number;
  /** Code ISO 3 lettres. */
  country: string;
  /** Contour du lieu, pour le colorier au survol. Charge d'avance (departement, region) ou au survol (commune). */
  rings?: [number, number][][];
  /** Code INSEE d'une commune : de quoi aller chercher son contour au survol. */
  code?: string;
}

/** Deux sources nomment le meme lieu s'il porte le meme nom a moins de ce nombre de degres. */
const SAME_PLACE_DEG = 0.25;
/** Un lieu retenu compte au moins cette part de la population du premier. */
const MIN_SHARE = 0.005;

const keyOf = (name: string) =>
  name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z]/gi, "")
    .toLowerCase();

/** Cadre de chaque contour, calcule au premier besoin. */
const boxes = new WeakMap<Place, ReturnType<typeof ringsBounds>>();

/** Lieux tries du plus peuple au moins peuple. */
export class PlaceIndex {
  /** Incremente a chaque ajout. */
  version = 0;
  private _places: Place[] = [];

  /** Oublie tout : on change de niveau de focus, les lieux precedents n'ont plus cours. */
  clear(): void {
    this._places = [];
    this.version++;
  }

  /** Ajoute des lieux ; un lieu deja connu (meme nom, tout pres) garde la plus grande population. */
  add(places: Place[]): void {
    const byName = new Map<string, Place[]>();
    for (const p of this._places) byName.set(keyOf(p.name), [...(byName.get(keyOf(p.name)) ?? []), p]);
    const dropped = new Set<Place>();
    const added: Place[] = [];
    for (const p of places) {
      const twin = byName.get(keyOf(p.name))?.find((q) => Math.abs(q.lon - p.lon) < SAME_PLACE_DEG && Math.abs(q.lat - p.lat) < SAME_PLACE_DEG);
      if (twin) {
        // Les deux sources ne savent pas la meme chose : celle qui perd laisse son code et son contour.
        // Sans cela, une ville comptee par son agglomeration (Natural Earth) perd le code INSEE de sa commune.
        const winner = twin.population >= p.population ? twin : p;
        const loser = winner === twin ? p : twin;
        winner.code ??= loser.code;
        winner.rings ??= loser.rings;
        if (winner === twin) continue;
        dropped.add(twin);
      }
      added.push(p);
    }
    this._places = [...this._places.filter((p) => !dropped.has(p)), ...added].sort((a, b) => b.population - a.population);
    this.version++;
  }

  /** Lieux dont le nom commence par `query`, les plus peuples d'abord ; accents et casse ignores. */
  search(query: string, limit: number): Place[] {
    const key = keyOf(query);
    if (!key) return [];
    const starts = this._places.filter((p) => keyOf(p.name).startsWith(key));
    const inside = this._places.filter((p) => !starts.includes(p) && keyOf(p.name).includes(key));
    return [...starts, ...inside].slice(0, limit);
  }

  /** Lieu dont le contour contient le point, s'il est connu (departements, regions, communes deja survolees). */
  containing(lon: number, lat: number): Place | null {
    for (const p of this._places) {
      if (!p.rings) continue;
      let box = boxes.get(p);
      if (!box) boxes.set(p, (box = ringsBounds(p.rings)));
      if (lon < box.west || lon > box.east || lat < box.south || lat > box.north) continue;
      if (ringsContain(p.rings, lon, lat)) return p;
    }
    return null;
  }

  /** Commune connue sous ce code INSEE : la meme que son etiquette, pour que les deux partagent un accent. */
  withCode(code: string): Place | null {
    return this._places.find((p) => p.code === code) ?? null;
  }

  /**
   * Au plus `limit` lieux de `bounds`, du plus peuple au moins peuple, parmi ceux que `accept` retient.
   * Les lieux deux cents fois moins peuples que le premier sont ignores.
   */
  pick(bounds: GeoBounds, limit: number, accept: (place: Place) => boolean = () => true): Place[] {
    const picked: Place[] = [];
    let floor = 0;
    for (const p of this._places) {
      if (picked.length >= limit || p.population < floor) break;
      if (p.lon < bounds.west || p.lon > bounds.east || p.lat < bounds.south || p.lat > bounds.north) continue;
      if (!accept(p)) continue;
      picked.push(p);
      floor ||= p.population * MIN_SHARE;
    }
    return picked;
  }
}
