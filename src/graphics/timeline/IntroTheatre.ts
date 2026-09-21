import pistes from "@graphics/config/timeline.tracks.json";
import { Theatre, type TheatreBindings } from "./Theatre.ts";
import type { TimelineTrack } from "./Timeline.type.ts";

/** Identifiant du theatre, et sa cle dans `timeline.tracks.json`. */
export const INTRO_THEATRE = "intro";
/** Duree de la timeline (s) : le passage, puis l'interface et les noms. */
const DURATION = 3;

/**
 * Theatre de l'intro : le passage de la page a la carte (progres et forme du masque de composition), l'entree
 * de l'interface et celle des noms. Les pistes sont celles du fichier, reglees dans la timeline de SONDE ; les
 * liaisons disent ou chaque scalaire s'ecrit dans la scene.
 */
export function createIntroTheatre(bindings: TheatreBindings): Theatre {
  const tracks = (pistes as Record<string, unknown>)[INTRO_THEATRE] as Record<string, Record<string, TimelineTrack>> | undefined;
  // Copie : le theatre edite ses pistes en place, le module importe doit rester tel que le fichier le decrit.
  return new Theatre({ id: INTRO_THEATRE, duration: DURATION, bindings, tracks: structuredClone(tracks ?? {}) });
}

// Chaque enregistrement de la timeline reecrit le fichier : sans cet arret, le HMR remonterait jusqu'a
// `ThreeStage` et recreerait toute la scene. Les pistes sont deja dans le theatre.
import.meta.hot?.accept("../config/timeline.tracks.json", () => {});
