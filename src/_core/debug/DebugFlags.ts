import { DEBUG_CONFIG } from "../../graphics/debug/debug.config.ts";

/**
 * Drapeaux d'outillage demandes par l'URL, retenus pour la session.
 *
 *     ?debug     ouvre        ?debug=0   referme
 *
 * `sessionStorage` et non `localStorage` : le drapeau meurt avec l'onglet, la
 * ou l'autre le ferait revenir des semaines plus tard sans qu'on se souvienne
 * de l'avoir demande.
 *
 * Importable AVANT la creation du device : `ThreeStage` importe `ThreeDevice`
 * dynamiquement pour garder three.js hors du premier bundle, et les drapeaux se
 * lisent avant. D'ou la seule dependance a `debug.config.ts`, qui est leger.
 */

/**
 * `sessionStorage` est partage par origine : sans prefixe, deux projets servis
 * sur `localhost` se passeraient leurs drapeaux.
 */
function sessionKey(name: string): string {
  return `${DEBUG_CONFIG.sessionPrefix ?? "app"}:${name}`;
}

export function readUrlFlag(name: string): boolean {
  if (typeof globalThis.window === "undefined") return false;
  const key = sessionKey(name);
  const requested = new URL(globalThis.window.location.href).searchParams.get(name);
  if (requested !== null) {
    if (requested === "0" || requested === "false") globalThis.sessionStorage.removeItem(key);
    else globalThis.sessionStorage.setItem(key, "1");
  }
  return globalThis.sessionStorage.getItem(key) === "1";
}

/**
 * Le panneau de debug est-il demande ? Partout, deploiement compris.
 *
 * Le panneau est l'outil de reglage, et regler depuis un telephone suppose
 * qu'il existe la ou le telephone peut aller. C'est un verrou d'ACCES, rien
 * d'autre : une fois ouvert, tout ce qu'il contient fonctionne. Brider une
 * commande pour proteger un environnement donne un curseur qui repond sans rien
 * faire, ce qui est pire que pas de curseur.
 */
export function isDebugRequested(): boolean {
  return readUrlFlag("debug");
}

/**
 * Le compteur d'images est-il demande ? Partout, production comprise : mesurer
 * la cadence sur la machine de quelqu'un d'autre n'a de sens que la ou le site
 * est reellement deploye. Il n'ouvre ni panneau ni reglage.
 */
export function isStatsRequested(): boolean {
  return readUrlFlag("stats");
}
