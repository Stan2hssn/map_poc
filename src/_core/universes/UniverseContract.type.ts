// UniverseContract.type.ts
import type { NodeId } from "@graphics/nodes/Node.id.ts";


export interface IUniverseContract {
  id: NodeId;

  /**
   * Liste des ids de nodes qui doivent être montés quand ce contrat est actif.
   * (Aucune logique d'animation ici)
   */
  activeNodeIds: NodeId[];
}
