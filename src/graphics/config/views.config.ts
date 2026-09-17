import { WORLD_WIDTH_KM } from "@graphics/terrain/GeoProjection.ts";

/** Raccourcis de navigation. */
export const MAP_VIEWS = {
  paris: { label: "Paris", lon: 2.3488, lat: 48.8534, extentKm: 30 },
  france: { label: "France", lon: 2.4, lat: 46.6, extentKm: 1150 },
  world: { label: "Monde", lon: 0, lat: 0, extentKm: WORLD_WIDTH_KM },
} as const;

export type MapViewId = keyof typeof MAP_VIEWS;
