import type { DebugPersistence, DebugValues } from "@_core/debug/DebugValues.ts";
import file from "../config/debug.values.json";

// Fichier partage avec la sonde (cle `gl`) : le pont fusionne par cle, chacun garde la sienne.
const KEY = "tweakpane";

const ROUTE = "/__sonde/debug";

// Import statique, inline par Vite : en production il n'y a pas de pont a interroger.
const values: DebugValues = ((file as Record<string, unknown>)[KEY] as DebugValues | undefined) ?? {};

// Chaque ecriture du panneau touche le JSON : sans cet arret, le HMR recree toute la scene depuis `ThreeStage`.
import.meta.hot?.accept("../config/debug.values.json", () => {});

function persist(next: DebugValues): void {
  // La route n'existe qu'en dev : en production on n'empile pas de 404.
  if (!import.meta.dev) return;

  void fetch(ROUTE, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: KEY, tracks: next }),
  })
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    })
    .catch((error) => console.warn("[debug] reglages non ecrits", error));
}

export const DEBUG_PERSISTENCE: DebugPersistence = { values, persist };
