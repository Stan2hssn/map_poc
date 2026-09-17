import type { GeoBounds } from "./GeoProjection.ts";

/** Pas en degres, de 15 secondes a 45 degres. */
const STEPS = [15 / 3600, 30 / 3600, 1 / 60, 2 / 60, 5 / 60, 10 / 60, 15 / 60, 30 / 60, 1, 2, 5, 10, 15, 30, 45];

/** Plus petit pas qui donne au plus `max` meridiens sur l'emprise. */
export function graticuleStep(bounds: GeoBounds, max: number): number {
  const span = bounds.east - bounds.west;
  return STEPS.find((step) => span / step <= max) ?? STEPS.at(-1)!;
}

/** Multiples de `step` compris dans [min, max]. */
export function graticuleValues(min: number, max: number, step: number): number[] {
  const values: number[] = [];
  for (let i = Math.ceil(min / step); i * step <= max; i++) values.push(i * step);
  return values;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** 3°E, 3°34′E ou 3°34′15″E selon le pas. */
export function formatDegrees(value: number, step: number, positive: string, negative: string): string {
  const seconds = Math.round(Math.abs(value) * 3600);
  const d = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const hemisphere = value < 0 ? negative : positive;
  if (step >= 1) return `${d}°${hemisphere}`;
  if (step >= 1 / 60) return `${d}°${pad(m)}′${hemisphere}`;
  return `${d}°${pad(m)}′${pad(seconds % 60)}″${hemisphere}`;
}
