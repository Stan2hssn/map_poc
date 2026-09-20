import type { MapFocusId } from "@graphics/config/focus.config.ts";

export interface MapView {
  lon: number;
  lat: number;
  /** Largeur couverte par le bloc. */
  extentKm: number;
}

/** Ce que l'interface peut demander a la scene, sans importer three. */
export default interface IMapNavigator {
  flyTo(view: MapView): void;
  /** Niveau nomme par la carte : communes, departements ou regions. */
  setFocus(focus: MapFocusId): void;
  /** Rien n'est dessine : la page reste blanche pendant que la carte se charge. */
  holdIntro(): void;
  /** La carte se dessine en s'ouvrant, et vole vers `view` si elle est donnee. */
  drawMap(view?: MapView): void;
}

export function isMapNavigator<T extends object>(value: T): value is T & IMapNavigator {
  return "flyTo" in value;
}
