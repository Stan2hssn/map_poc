import { fileURLToPath } from 'node:url'
import glsl from 'vite-plugin-glsl'

const engine = (path: string) => fileURLToPath(new URL(path, import.meta.url))

export default defineNuxtConfig({
  compatibilityDate: '2026-08-31',

  // SONDE est une DEPENDANCE : plus de chemin absolu a tenir a jour, plus
  // d'alias conditionnel, et un clone du depot se construit sur n'importe
  // quelle machine. Le module ne fait rien hors developpement.
  modules: ['@sonde/core/nuxt'],

  sonde: {
    panels: '~/sonde.config',
    // Routes d'ecriture du serveur de dev : la sonde y poste, le plugin Vite de
    // SONDE ecrit dans le fichier. Chemins relatifs a la racine du projet.
    routes: {
      timeline: 'src/graphics/config/timeline.tracks.json',
      debug: 'src/graphics/config/debug.values.json',
    },
  },

  ssr: true,

  // Le moteur vit dans `src/`, hors du srcDir Nuxt. `@` est REDEFINI sur
  // `src/` : le moteur importe en `@/_core` et `@/graphics`, le code Vue
  // n'utilise que `~`, qui pointe toujours sur `app/`.
  alias: {
    '@': engine('./src'),
    '@_core': engine('./src/_core'),
    '@graphics': engine('./src/graphics'),
    '@postprocessing': engine('./src/graphics/postprocessing'),
    '@universes': engine('./src/graphics/universes'),
    '@adapters': engine('./src/graphics/adapters'),

    // Enregistres SEULEMENT si la bibliotheque est la. Un alias qui pointe
    // dans le vide ne derange personne tant que rien ne l'importe, mais il
  },

  // Sans cet ajout, `src/` reste hors du tsconfig genere : ni le moteur ni ses
  // declarations `*.frag` / `*.vert` ne seraient verifies par `nuxt typecheck`.
  // Chemin relatif a `.nuxt/`, ou le fichier est ecrit.
  typescript: {
    tsConfig: {
      include: ['../src/**/*'],
      // Le pont vers la sonde importe la spice en statique. Sans elle, il ne
      // peut pas etre type — et il n'est de toute facon jamais monte, le
      compilerOptions: {
        // Nuxt ajoute ces deux flags, que le contrat du boilerplate ne pose
        // pas. Les laisser actifs ferait echouer `typecheck` sur les nodes de
        // demonstration livrees avec le template.
        noUncheckedIndexedAccess: false,
        noImplicitOverride: false,
      },
    },
  },

  css: ['~/assets/css/main.css', '~/assets/css/labels.css', '~/assets/css/chrome.css'],

  build: {
    transpile: ['gsap'],
  },

  vite: {
    // Le plugin Vite de la sonde s'enregistre depuis `modules/sonde`, qui ne
    // fait rien hors developpement. Ne reste ici que l'autorisation de servir

    // Obligatoire et non cosmetique : les shaders du moteur utilisent
    // `#include`, que seul ce plugin resout. Un import `?raw` livrerait la
    // directive telle quelle au compilateur GLSL.
    plugins: [
      glsl({
        include: ['**/*.glsl', '**/*.wgsl', '**/*.vert', '**/*.frag', '**/*.vs', '**/*.fs'],
        warnDuplicatedImports: true,
        defaultExtension: 'glsl',
        watch: true,
      }),
    ],
  },

  app: {
    head: {
      htmlAttrs: { lang: 'fr' },
      meta: [
        { name: 'theme-color', content: '#060606' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
      ],
      link: [
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        // Relief, PLAN IGN et communes : la connexion (TLS compris) s'ouvre pendant que le moteur demarre.
        { rel: 'preconnect', href: 'https://data.geopf.fr', crossorigin: '' },
        { rel: 'preconnect', href: 'https://geo.api.gouv.fr', crossorigin: '' },
        {
          rel: 'stylesheet',
          href: 'https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&family=Bodoni+Moda:opsz,wght@6..96,400;6..96,500&display=swap',
        },
      ],
    },
  },

  // La sonde remplace @nuxt/devtools : deux outils qui posent chacun un calque
  // plein viewport au-dessus de la page se disputent le pointeur pour rien.
  devtools: { enabled: false },
})
