import { fetchDepartmentAt, fetchDepartmentCommunes } from "@graphics/places/PlaceSources.ts";
import type { Place } from "@graphics/places/PlaceIndex.ts";
import type { GeoBounds } from "@graphics/terrain/GeoProjection.ts";

/** Au-dela de cette largeur de vue, les villes du monde suffisent. */
const MAX_EXTENT_KM = 250;
/** Points sondes par cote de la vue, et pas (degres) auquel une sonde est reutilisee. */
const PROBES = 3;
const PROBE_STEP_DEG = 0.05;

/**
 * Communes francaises chargees par departement, la ou regarde la vue : quelques sondes
 * (departement d'un point) puis les communes de chaque departement nouveau, une seule fois.
 */
export class FrenchCommunesHelper {
  private readonly _signal: AbortSignal;
  private readonly _onPlaces: (places: Place[]) => void;
  private readonly _probes = new Set<string>();
  private readonly _departments = new Set<string>();

  constructor(signal: AbortSignal, onPlaces: (places: Place[]) => void) {
    this._signal = signal;
    this._onPlaces = onPlaces;
  }

  update(bounds: GeoBounds, extentKm: number): void {
    if (extentKm > MAX_EXTENT_KM) return;
    for (let i = 0; i < PROBES; i++) {
      for (let j = 0; j < PROBES; j++) {
        const lon = bounds.west + ((i + 0.5) / PROBES) * (bounds.east - bounds.west);
        const lat = bounds.south + ((j + 0.5) / PROBES) * (bounds.north - bounds.south);
        const key = `${Math.round(lon / PROBE_STEP_DEG)}:${Math.round(lat / PROBE_STEP_DEG)}`;
        if (this._probes.has(key)) continue;
        this._probes.add(key);
        void this._probe(lon, lat);
      }
    }
  }

  private async _probe(lon: number, lat: number): Promise<void> {
    try {
      const code = await fetchDepartmentAt(lon, lat, this._signal);
      if (!code || this._departments.has(code)) return;
      this._departments.add(code);
      this._onPlaces(await fetchDepartmentCommunes(code, this._signal));
    } catch (error) {
      if (!this._signal.aborted) console.warn("[Labels] communes indisponibles", error);
    }
  }
}
