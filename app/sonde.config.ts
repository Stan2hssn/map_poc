import { threePipeline } from '@sonde/core/three-pipeline'
import type { DevtoolsOpts } from '@sonde/core'
import { isDebugRequested } from '@_core/debug/DebugFlags.ts'
import { EASE_NAMES, sampleEase } from '@graphics/timeline/ease.ts'
import { INTRO_THEATRE } from '@graphics/timeline/IntroTheatre.ts'
import { REVISION } from 'three'

// Pas `getTheatreIds()` : le panneau veut la liste avant que l'univers ne soit monte.
const THEATRES = [INTRO_THEATRE]

export default function sonde(): DevtoolsOpts | null {
  if (!isDebugRequested()) return null

  return threePipeline({
    namespace: 'map',
    stage: useThreeStage(),
    theatres: THEATRES,
    ease: { names: EASE_NAMES, sample: sampleEase },
    version: `three ${REVISION}`,
  })
}
