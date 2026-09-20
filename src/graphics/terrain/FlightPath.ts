/** Trajectoire de vol entre deux vues, parcourue par `s` de 0 a `length`. */
export interface FlightPath {
  /** Longueur du chemin (sans unite) : la duree du vol en depend. */
  length: number;
  /** Largeur de vue au point `s` (unite de `w0` et `w1`). */
  width(s: number): number;
  /** Part du trajet au sol parcourue au point `s` (0 au depart, 1 a l'arrivee). */
  progress(s: number): number;
}

/**
 * Vol de van Wijk et Nuij (2003), celui du `flyTo` de Mapbox : on dezoome juste assez pour garder depart et
 * arrivee en vue, a vitesse percue constante. Largeurs de vue `w0` et `w1`, distance au sol `u1` (meme unite) ;
 * `rho` regle l'ampleur du dezoom (Mapbox : 1,42 ; plus petit, plus plat et plus long).
 */
export function flightPath(w0: number, w1: number, u1: number, rho: number): FlightPath {
  const rho2 = rho * rho;
  const r = (arrival: boolean) => {
    const b = (w1 * w1 - w0 * w0 + (arrival ? -1 : 1) * rho2 * rho2 * u1 * u1) / (2 * (arrival ? w1 : w0) * rho2 * u1);
    return Math.log(Math.sqrt(b * b + 1) - b);
  };
  const r0 = r(false);
  const length = (r(true) - r0) / rho;
  if (u1 > 1e-9 && Number.isFinite(length)) {
    return {
      length,
      width: (s) => (w0 * Math.cosh(r0)) / Math.cosh(r0 + rho * s),
      progress: (s) => (w0 * (Math.cosh(r0) * Math.tanh(r0 + rho * s) - Math.sinh(r0))) / rho2 / u1,
    };
  }
  // Sur place : zoom seul, a vitesse percue constante.
  const zoom = Math.log(w1 / w0);
  const direction = Math.sign(zoom);
  return {
    length: Math.abs(zoom) / rho,
    width: (s) => w0 * Math.exp(direction * rho * s),
    progress: () => 1,
  };
}
