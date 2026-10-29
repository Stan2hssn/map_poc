export const UNIVERSE_ID = {
  MAIN: "MAIN",
} as const;

export type UniverseId = (typeof UNIVERSE_ID)[keyof typeof UNIVERSE_ID];
