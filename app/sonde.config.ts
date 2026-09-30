import { threePipeline } from '@sonde/core/three-pipeline'
import type { DevtoolsOpts } from '@sonde/core'
import { isDebugRequested } from '@_core/debug/DebugFlags.ts'
import { EASE_NAMES, sampleEase } from '@graphics/timeline/ease.ts'
import { REVISION } from 'three'

/**
 * Ce que SONDE monte dans ce projet.
 *
 * `@sonde/core/nuxt` appelle cette fonction au chargement du plugin client, en
 * developpement seulement. L'adaptateur `three-pipeline` porte tout ce que les
 * projets de cette famille ecrivaient a l'identique : lecteur d'univers,
 * compteur d'images, attente du theatre, cadence de lecture.
 */

/**
 * La liste est ici et non lue depuis `getTheatreIds()` parce que le panneau la
 * veut au montage, bien avant que l'univers ne soit monte.
 */
const THEATRES = ['intro']

export default function sonde(): DevtoolsOpts | null {
  // Meme regle que le panneau du moteur : la sonde se monte sur demande de
  // l'URL, pas d'office.
  if (!isDebugRequested()) return null

  return threePipeline({
    namespace: 'map',
    stage: useThreeStage(),
    theatres: THEATRES,
    ease: { names: EASE_NAMES, sample: sampleEase },
    version: `three ${REVISION}`,
  })
}
