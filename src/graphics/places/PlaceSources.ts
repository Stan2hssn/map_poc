import type { Place } from "./PlaceIndex.ts";

/** Villes du monde (Natural Earth, ~7 300), population de l'agglomeration. */
export const WORLD_CITIES_URL =
  "https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@v5.1.2/geojson/ne_10m_populated_places_simple.geojson";
/** Communes francaises (geo.api.gouv.fr, ~35 000), population municipale. */
export const FRENCH_COMMUNES_URL = "https://geo.api.gouv.fr/communes?fields=nom,centre,population&format=json";

interface WorldCity {
  properties: { name: string; pop_max: number; adm0_a3: string };
  geometry: { coordinates: [number, number] };
}

interface Commune {
  nom: string;
  population?: number;
  centre?: { coordinates: [number, number] };
}

async function getJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`${url} : HTTP ${response.status}`);
  return (await response.json()) as T;
}

export async function fetchWorldCities(signal: AbortSignal): Promise<Place[]> {
  const { features } = await getJson<{ features: WorldCity[] }>(WORLD_CITIES_URL, signal);
  return features.map(({ properties: p, geometry }) => ({
    name: p.name,
    lon: geometry.coordinates[0],
    lat: geometry.coordinates[1],
    population: p.pop_max,
    country: p.adm0_a3,
  }));
}

export async function fetchFrenchCommunes(signal: AbortSignal): Promise<Place[]> {
  const communes = await getJson<Commune[]>(FRENCH_COMMUNES_URL, signal);
  return communes.flatMap(({ nom, population, centre }) =>
    centre ? [{ name: nom, lon: centre.coordinates[0], lat: centre.coordinates[1], population: population ?? 0, country: "FRA" }] : []
  );
}
