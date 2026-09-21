import {
  codePanel,
  consolePanel,
  glPanel,
  mountDevtools,
  netPanel,
  settingsPanel,
  shortcutsPanel,
  threeAdapter,
  timelinePanel,
} from '@spices/devtools'
import { isDebugRequested } from '@_core/debug/DebugFlags.ts'
import { EASE_NAMES, sampleEase } from '@graphics/timeline/ease.ts'
import type { Theatre } from '@graphics/timeline/Theatre.ts'
import { REVISION, type Scene, type WebGLRenderer } from 'three'

/** Pont dev `modules/sonde` vers `src/graphics/config/debug.values.json`. */
const DEBUG_ENDPOINT = '/__sonde/debug'
/** Pont dev vers `src/graphics/config/timeline.tracks.json`, une cle par theatre. */
const TIMELINE_ENDPOINT = '/__sonde/timeline'
/**
 * Theatres offerts dans le panneau Timeline. La liste est ici et non lue depuis l'univers : le panneau la
 * veut au montage, bien avant que l'univers ne soit monte.
 */
const THEATRES = ['intro']

/** Univers qui publie des theatres. Teste a l'execution, pas suppose. */
interface TheatreHost {
  getTheatre(id: string): Theatre | undefined
}

function asTheatreHost(value: unknown): TheatreHost | null {
  return typeof (value as Partial<TheatreHost> | undefined)?.getTheatre === 'function' ? (value as TheatreHost) : null
}

/** Ecrit au pont, et rend l'echec au panneau plutot que de le laisser dans la console. */
function post(endpoint: string, body: unknown): Promise<void> {
  return fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then((response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
  })
}

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

  /**
   * Resolu a l'ouverture de l'onglet, jamais capture au montage du plugin : le theatre n'existe qu'une fois
   * l'univers monte. On attend au lieu d'echouer sur-le-champ, sans quoi le panneau resterait bloque sur
   * « theatre introuvable » pour toute la session.
   */
  const loadTheatre = async (id: string): Promise<Theatre> => {
    const limit = performance.now() + 20_000
    for (;;) {
      const theatre = asTheatreHost(activeUniverse())?.getTheatre(id)
      if (theatre) return theatre
      if (performance.now() > limit) throw new Error(`[sonde] theatre introuvable apres 20 s : ${id}`)
      await new Promise((next) => setTimeout(next, 120))
    }
  }

  /** Sans ce rappel le panneau retombe sur le presse-papier, et rien ne relirait le reglage au rechargement. */
  const saveTimeline = (id: string, state: unknown): Promise<void> => {
    const tracks = (state as { tracks?: unknown } | null)?.tracks
    if (tracks === undefined) return Promise.reject(new Error('instantané sans pistes'))
    return post(TIMELINE_ENDPOINT, { id, tracks })
  }

  mountDevtools({
    // Nomme le projet : sans lui la cle retomberait sur le hostname, partage
    // par tous les projets servis depuis localhost.
    namespace: 'map',
    addons: [
      glPanel({
        // L'etat est clef par NOM : l'identifiant du moteur est un uuid
        // regenere a chaque chargement.
        save: (state) => post(DEBUG_ENDPOINT, { id: 'gl', tracks: state }),
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
      timelinePanel({
        ids: THEATRES,
        loadTheatre,
        easeNames: EASE_NAMES,
        sampleEase,
        save: saveTimeline,
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
