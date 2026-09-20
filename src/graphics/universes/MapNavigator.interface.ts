import type { MapFocusId } from "@graphics/config/focus.config.ts";

/** Lieu choisi sur la carte, tel que l'interface en a besoin. */
export interface SelectedPlace {
  name: string;
  lon: number;
  lat: number;
}

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
  /** Releves affiches par l'interface : largeur de la vue et point vise. */
  readout(): { extentKm: number; lon: number; lat: number };
  /** Prevenu quand un nom de la carte est choisi ; rend de quoi se desabonner. */
  onPlaceSelected(listener: (place: SelectedPlace) => void): () => void;
  /** Lieux du niveau courant dont le nom approche `query`, pour la recherche de l'interface. */
  searchPlaces(query: string, limit: number): SelectedPlace[];
  /** Cadre et vol jusqu'a un lieu : un territoire entier tient dans la vue, une ville arrive de pres. */
  goToPlace(place: SelectedPlace): void;
  /** Rien n'est dessine : la page reste blanche pendant que la carte se charge. */
  holdIntro(): void;
  /** La carte se dessine en s'ouvrant, et vole vers `view` si elle est donnee. */
  drawMap(view?: MapView): void;
}

export function isMapNavigator<T extends object>(value: T): value is T & IMapNavigator {
  return "flyTo" in value;
}
