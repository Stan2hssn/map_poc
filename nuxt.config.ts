import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import glsl from 'vite-plugin-glsl'

const engine = (path: string) => fileURLToPath(new URL(path, import.meta.url))

/**
 * Les devtools « spices » vivent HORS du depot, partages entre projets.
 *
 * Le chemin est surchargeable par `SPICES_DEVTOOLS`, et surtout FACULTATIF —
 * absent, la sonde ne se monte pas et tout le reste tourne. Sans quoi un clone
 * du depot ne se construirait sur aucune autre machine : l'alias ne resoudrait
 * rien.
 */
const SPICES = process.env.SPICES_DEVTOOLS ?? '/Users/stan_husson/Dev/PV/_lib/devtools'
const AVEC_SONDE = existsSync(SPICES)

export default defineNuxtConfig({
  compatibilityDate: '2026-08-31',

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
    // laisse croire a une dependance satisfaite.
    ...(AVEC_SONDE
      ? {
          '@spices/devtools/vite': `${SPICES}/vite/index.ts`,
          '@spices/devtools': SPICES,
        }
      : {}),
  },

  // Sans cet ajout, `src/` reste hors du tsconfig genere : ni le moteur ni ses
  // declarations `*.frag` / `*.vert` ne seraient verifies par `nuxt typecheck`.
  // Chemin relatif a `.nuxt/`, ou le fichier est ecrit.
  typescript: {
    tsConfig: {
      include: ['../src/**/*'],
      // Le pont vers la sonde importe la spice en statique. Sans elle, il ne
      // peut pas etre type — et il n'est de toute facon jamais monte, le
      // module `sonde` rendant la main avant de l'enregistrer.
      ...(AVEC_SONDE ? {} : { exclude: ['../app/sonde/**'] }),
      compilerOptions: {
        // Nuxt ajoute ces deux flags, que le contrat du boilerplate ne pose
        // pas. Les laisser actifs ferait echouer `typecheck` sur les nodes de
        // demonstration livrees avec le template.
        noUncheckedIndexedAccess: false,
        noImplicitOverride: false,
      },
    },
  },

  css: ['~/assets/css/main.css', '~/assets/css/labels.css'],

  build: {
    transpile: ['gsap'],
  },

  vite: {
    // Le plugin Vite de la sonde s'enregistre depuis `modules/sonde`, qui ne
    // fait rien hors developpement. Ne reste ici que l'autorisation de servir
    // `_lib`, une chaine que le build ne resout jamais.
    server: { fs: { allow: AVEC_SONDE ? ['..', SPICES] : ['..'] } },

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
        { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Manrope:wght@500;700&display=swap' },
      ],
    },
  },

  // La sonde remplace @nuxt/devtools : deux outils qui posent chacun un calque
  // plein viewport au-dessus de la page se disputent le pointeur pour rien.
  devtools: { enabled: false },
})
