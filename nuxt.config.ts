import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const engine = (path: string) => fileURLToPath(new URL(path, import.meta.url))

// Pas de require.resolve : @sonde/core n'exporte pas son package.json.
const hasPackage = (name: string) => existsSync(engine(`./node_modules/${name}/package.json`))

export default defineNuxtConfig({
  compatibilityDate: '2026-08-31',

  // SONDE (depot prive, dependance optionnelle) n'est pas installable sur Vercel ; son module ne fait rien hors dev.
  modules: hasPackage('@sonde/core') ? ['@sonde/core/nuxt'] : [],

  sonde: {
    panels: '~/sonde.config',
    // Fichiers ecrits par le serveur de dev, relatifs a la racine du projet.
    routes: {
      timeline: 'src/graphics/config/timeline.tracks.json',
      debug: 'src/graphics/config/debug.values.json',
    },
  },

  ssr: true,

  // `@` est redefini sur `src/` (le moteur, hors du srcDir) ; le code Vue n'utilise que `~`.
  alias: {
    '@': engine('./src'),
    '@_core': engine('./src/_core'),
    '@graphics': engine('./src/graphics'),
    '@postprocessing': engine('./src/graphics/postprocessing'),
    '@universes': engine('./src/graphics/universes'),
    '@adapters': engine('./src/graphics/adapters'),
  },

  // Sans cet ajout, `nuxt typecheck` ignore `src/` et `tests/`. Chemin relatif a `.nuxt/`.
  typescript: {
    tsConfig: {
      include: ['../src/**/*', '../tests/**/*'],
      compilerOptions: {
        // Ajoutes par Nuxt, absents du contrat du boilerplate : ils feraient echouer le template.
        noUncheckedIndexedAccess: false,
        noImplicitOverride: false,
      },
    },
  },

  css: ['~/assets/css/main.css', '~/assets/css/labels.css', '~/assets/css/chrome.css'],

  app: {
    head: {
      htmlAttrs: { lang: 'fr' },
      meta: [
        { name: 'theme-color', content: '#060606' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
      ],
      link: [
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        // Relief, PLAN IGN et communes : la connexion s'ouvre pendant que le moteur demarre.
        { rel: 'preconnect', href: 'https://data.geopf.fr', crossorigin: '' },
        { rel: 'preconnect', href: 'https://geo.api.gouv.fr', crossorigin: '' },
        {
          rel: 'stylesheet',
          href: 'https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&family=Bodoni+Moda:opsz,wght@6..96,400;6..96,500&display=swap',
        },
      ],
    },
  },

  // SONDE remplace les devtools : deux calques plein ecran se disputeraient le pointeur.
  devtools: { enabled: false },
})
