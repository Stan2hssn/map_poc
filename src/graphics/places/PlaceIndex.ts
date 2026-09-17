import type { GeoBounds } from "@graphics/terrain/GeoProjection.ts";

export interface Place {
  name: string;
  lon: number;
  lat: number;
  population: number;
  /** Code ISO 3 lettres. */
  country: string;
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

/** Lieux tries du plus peuple au moins peuple. */
export class PlaceIndex {
  /** Incremente a chaque ajout. */
  version = 0;
  private _places: Place[] = [];

  /** Ajoute des lieux ; un lieu deja connu (meme nom, tout pres) garde la plus grande population. */
  add(places: Place[]): void {
    const byName = new Map<string, Place[]>();
    for (const p of this._places) byName.set(keyOf(p.name), [...(byName.get(keyOf(p.name)) ?? []), p]);
    const dropped = new Set<Place>();
    const added: Place[] = [];
    for (const p of places) {
      const twin = byName.get(keyOf(p.name))?.find((q) => Math.abs(q.lon - p.lon) < SAME_PLACE_DEG && Math.abs(q.lat - p.lat) < SAME_PLACE_DEG);
      if (twin && twin.population >= p.population) continue;
      if (twin) dropped.add(twin);
      added.push(p);
    }
    this._places = [...this._places.filter((p) => !dropped.has(p)), ...added].sort((a, b) => b.population - a.population);
    this.version++;
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
