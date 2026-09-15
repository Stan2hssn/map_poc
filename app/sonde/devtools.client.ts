import {
  codePanel,
  consolePanel,
  glPanel,
  mountDevtools,
  netPanel,
  settingsPanel,
  shortcutsPanel,
  threeAdapter,
} from '@spices/devtools'
import { isDebugRequested } from '@_core/debug/DebugFlags.ts'
import { REVISION, type Scene, type WebGLRenderer } from 'three'

/** Pont dev `modules/sonde` vers `src/graphics/config/debug.values.json`. */
const DEBUG_ENDPOINT = '/__sonde/debug'

/**
 * Cadence lissee sur une seconde glissante. SONDE ne mesure pas les images par
 * seconde elle-meme — elle refuse d'ouvrir une boucle rAF qui fausserait celle
 * de la page observee. Ici la page en fait DEJA tourner une en continu pour le
 * rendu : s'y greffer ne change donc pas la cadence, on compte seulement.
 */
function createFpsMeter(): () => number {
  let frames = 0
  let last = performance.now()
  let value = 0

  const tick = (): void => {
    frames += 1
    const now = performance.now()
    if (now - last >= 1000) {
      value = (frames * 1000) / (now - last)
      frames = 0
      last = now
    }
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)

  return () => Math.round(value)
}

/**
 * Montage de la spice devtools. Dev uniquement — `modules/sonde` ne pose ce
 * plugin que dans ce cas.
 *
 * Imports statiques volontairement : en dynamique, un echec de resolution est
 * avale par la promesse du plugin et l'outil disparait sans erreur.
 *
 * Le renderer et la scene sont des LECTEURS et non des references : l'univers
 * actif change au fil des contrats, et le device meurt et renait aux
 * changements de route.
 */
export default defineNuxtPlugin(() => {
  if (!import.meta.dev) return

  // Meme regle que le panneau du moteur : la pastille et le panneau se montent
  // sur demande de l'URL, pas d'office.
  if (!isDebugRequested()) return

  const stage = useThreeStage()
  const fps = createFpsMeter()

  const activeUniverse = (): unknown =>
    stage.read()?.runtime.output.getActiveUniverses().at(-1)

  mountDevtools({
    // Nomme le projet : sans lui la cle retomberait sur le hostname, partage
    // par tous les projets servis depuis localhost.
    namespace: 'map',
    addons: [
      glPanel({
        // L'etat est clef par NOM : l'identifiant du moteur est un uuid
        // regenere a chaque chargement.
        save: (state) =>
          fetch(DEBUG_ENDPOINT, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: 'gl', tracks: state }),
          }).then((response) => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
          }),
        adapter: threeAdapter({
          renderer: () => (stage.read()?.renderer as WebGLRenderer | undefined) ?? null,
          scene: () => {
            const universe = activeUniverse() as { scene?: Scene } | undefined
            return universe?.scene ?? null
          },
          fps,
          name: `three ${REVISION}`,
        }),
      }),
      consolePanel(),
      netPanel(),
    ],
    panels: [
      // Le graphe vient du plugin Vite dev-only enregistre par `modules/sonde`.
      codePanel({ graph: () => fetch('/__sonde/module-graph').then((r) => r.json()) }),
      settingsPanel({}),
      shortcutsPanel,
    ],
  })
})
