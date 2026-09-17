export interface MapView {
  lon: number;
  lat: number;
  /** Largeur couverte par le bloc. */
  extentKm: number;
}

/** Ce que l'interface peut demander a la scene, sans importer three. */
export default interface IMapNavigator {
  flyTo(view: MapView): void;
}

export function isMapNavigator<T extends object>(value: T): value is T & IMapNavigator {
  return "flyTo" in value;
}
