export const UNIVERSE_ID = {
  MAIN: "MAIN",
  DEBUG: "DEBUG",
} as const;

export type UniverseId = (typeof UNIVERSE_ID)[keyof typeof UNIVERSE_ID];
