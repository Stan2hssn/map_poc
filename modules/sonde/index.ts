import { existsSync } from 'node:fs'
import { addPlugin, addVitePlugin, createResolver, defineNuxtModule } from 'nuxt/kit'
import { sondeStateWriter } from './timeline-writer'

/**
 * Branche la sonde, et seulement en developpement.
 *
 * Le garde `import.meta.dev` d'un plugin arrete son EXECUTION, pas le bundler :
 * ses imports statiques restent a resoudre et entrent dans le graphe de
 * production. Ici, hors dev, `setup` rend la main avant tout `import()`, et
 * rien de la sonde n'y entre.
 */
const LIB = process.env.SPICES_DEVTOOLS ?? '/Users/stan_husson/Dev/PV/_lib/devtools'

export default defineNuxtModule({
  meta: { name: 'sonde', configKey: 'sonde' },

  async setup(_options, nuxt) {
    if (!nuxt.options.dev) return

    // FACULTATIVE. La bibliotheque vit hors du depot : sur tout autre poste que
    // celui qui l'heberge, elle manque. On rend la main plutot que de casser la
    // construction, et le plugin client n'est jamais enregistre — donc son
    // import statique de la spice n'a jamais a etre resolu.
    if (!existsSync(LIB)) {
      console.info(`[sonde] devtools absents de ${LIB} — panneau desactive. Definir SPICES_DEVTOOLS pour l'activer.`)
      return
    }

    // Chemin absolu assume : `_lib` n'est pas encore un paquet du workspace, et
    // les alias de l'app n'existent pas au moment ou la config se charge.
    const { sondeModuleGraph } = (await import(`${LIB}/vite/index.ts`)) as {
      sondeModuleGraph: () => unknown
    }
    addVitePlugin(sondeModuleGraph() as never)

    // Reglages du panneau Tweakpane (cle `tweakpane`) et etat du panneau GL
    // (cle `gl`), fusionnes dans le meme fichier ; pistes de la timeline, une
    // cle par theatre, dans le leur.
    const { resolve } = createResolver(import.meta.url)
    addVitePlugin(
      sondeStateWriter('/__sonde/debug', resolve('../../src/graphics/config/debug.values.json')) as never
    )
    addVitePlugin(
      sondeStateWriter('/__sonde/timeline', resolve('../../src/graphics/config/timeline.tracks.json')) as never
    )

    // Le fichier reste sous `app/` : la racine Vite de Nuxt y est fixee, et un
    // runtime pose dans `modules/` n'y resout plus ni `three` ni `~/`. Il vit
    // hors de `app/plugins/`, le seul dossier que Nuxt enregistre tout seul.
    addPlugin({ src: resolve('../../app/sonde/devtools.client'), mode: 'client' })
  },
})
