/**
 * Ids de nodes ET de contrats. `_core` type `IUniverseContract.id` en `NodeId` :
 * les deux partagent donc forcement le meme espace de noms. Le prefixe
 * `contract:` evite qu'un id de contrat puisse se confondre avec un id de node.
 */
export const NODE_ID = {
  CAMERA_MAIN: "camera-main",
  GRID_NODE: "grid-node",

  CUBE: "cube",

  CONTRACT_BASE: "contract:base",
} as const;

export type NodeId = (typeof NODE_ID)[keyof typeof NODE_ID];
