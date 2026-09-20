import { TERRAIN_CONFIG } from "@graphics/config/terrain.config.ts";

/** Raccourcis de navigation. */
export const MAP_VIEWS = {
  paris: { label: "Paris", lon: 2.3488, lat: 48.8534, extentKm: 30 },
  france: { label: "France", lon: 2.4, lat: 46.6, extentKm: 1150 },
  world: { label: "Monde", lon: 0, lat: 2, extentKm: TERRAIN_CONFIG.maxExtentKm },
} as const;

export type MapViewId = keyof typeof MAP_VIEWS;

/** Largeur de vue a l'arrivee sur une ville choisie (km) : son bati en relief, en un clic. */
export const CITY_EXTENT_KM = 3;
