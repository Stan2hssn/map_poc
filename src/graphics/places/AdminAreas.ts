import type { Place } from "./PlaceIndex.ts";
import { ringsOfGeometry, type Ring, type RingGeometry } from "./Rings.ts";

/**
 * Departements et regions avec leur contour. `geo.api.gouv.fr` ne sert ni `centre` ni `contour` a ces deux
 * niveaux (il accepte le parametre et ignore les champs) : la geometrie vient de `france-geojson`, en version
 * simplifiee (96 departements, 556 Ko ; 13 regions, 220 Ko). France metropolitaine seulement.
 */
const BASE = "https://cdn.jsdelivr.net/gh/gregoiredavid/france-geojson@master/";
const FILES = {
  departements: "departements-version-simplifiee.geojson",
  regions: "regions-version-simplifiee.geojson",
} as const;

export type AreaLevel = keyof typeof FILES;

interface AreaFeature {
  properties: { code: string; nom: string };
  geometry: RingGeometry;
}

/** Aire du contour en degres carres, par la formule du lacet : elle classe les zones, faute de population. */
function areaOf(rings: Ring[]): number {
  let total = 0;
  for (const ring of rings) {
    let sum = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      sum += (ring[j]![0] - ring[i]![0]) * (ring[j]![1] + ring[i]![1]);
    }
    total += Math.abs(sum) / 2;
  }
  return total;
}

/** Centre du plus grand anneau : le point ou poser le nom. */
function centerOf(rings: Ring[]): [number, number] {
  const ring = rings.reduce((biggest, r) => (r.length > biggest.length ? r : biggest), rings[0] ?? []);
  const lon = ring.reduce((sum, [x]) => sum + x, 0) / Math.max(1, ring.length);
  const lat = ring.reduce((sum, [, y]) => sum + y, 0) / Math.max(1, ring.length);
  return [lon, lat];
}

export async function fetchAreas(level: AreaLevel, signal: AbortSignal): Promise<Place[]> {
  const response = await fetch(BASE + FILES[level], { signal });
  if (!response.ok) throw new Error(`${FILES[level]} : HTTP ${response.status}`);
  const { features } = (await response.json()) as { features: AreaFeature[] };
  return features.map((feature) => {
    const rings = ringsOfGeometry(feature.geometry);
    const [lon, lat] = centerOf(rings);
    // `population` classe les lieux dans `PlaceIndex` : a ces niveaux c'est l'etendue qui fait l'importance.
    return { name: feature.properties.nom, lon, lat, population: Math.round(areaOf(rings) * 1e6), country: "FRA", rings };
  });
}
