// `_core` type les ids de contrat en `NodeId` : le prefixe `contract:` les distingue des nodes.
export const NODE_ID = {
  CAMERA_MAIN: "camera-main",
  TERRAIN: "terrain",
  LIGHTS: "lights",
  LABELS: "labels",
  PANEL: "panel",
  INTRO: "intro",
  SURVEY: "survey",
  BUILDINGS: "buildings",
  PLANES: "planes",
  CLOUDS: "clouds",

  CONTRACT_BASE: "contract:base",
} as const;

export type NodeId = (typeof NODE_ID)[keyof typeof NODE_ID];
