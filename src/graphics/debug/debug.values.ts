import type { DebugPersistence, DebugValues } from "@_core/debug/DebugValues.ts";
import fichier from "../config/debug.values.json";

/**
 * Clé du panneau Tweakpane dans `debug.values.json`.
 *
 * Le fichier est PARTAGE avec la sonde, qui y ecrit son propre etat sous `gl`.
 * Le pont d'ecriture fusionne par identifiant : sauvegarder l'un n'efface donc
 * pas l'autre, a condition que chacun garde sa cle.
 */
const CLE = "tweakpane";

/** Route du pont dev de `modules/sonde` — inexistante en production. */
const ROUTE = "/__sonde/debug";

/**
 * Reglages relus au demarrage.
 *
 * L'import est STATIQUE : Vite l'inline au build et le recharge par HMR des
 * que le fichier change. Un `fetch` aurait rendu le panneau dependant d'une
 * requete qui n'aboutit pas en production, ou il n'y a pas de pont.
 */
export const DEBUG_VALUES: DebugValues =
  ((fichier as Record<string, unknown>)[CLE] as DebugValues | undefined) ?? {};

/**
 * Ecrit les reglages dans le fichier du depot, en developpement seulement.
 *
 * En production la route n'existe pas : on rend la main plutot que d'empiler
 * des 404 dans la console d'un site publie.
 */
export function persistDebugValues(valeurs: DebugValues): void {
  if (!import.meta.dev) return;

  void fetch(ROUTE, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: CLE, tracks: valeurs }),
  })
    .then((reponse) => {
      if (!reponse.ok) throw new Error(`HTTP ${reponse.status}`);
    })
    .catch((erreur) => console.warn("[debug] reglages non ecrits", erreur));
}

export const DEBUG_PERSISTENCE: DebugPersistence = {
  values: DEBUG_VALUES,
  persist: persistDebugValues,
};
