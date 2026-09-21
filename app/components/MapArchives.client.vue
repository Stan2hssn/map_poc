<script setup lang="ts">
/**
 * Fonds d'un territoire, en panneau lateral : il s'ouvre au clic sur un nom de la carte, qui reste le sujet.
 *
 * Les entrees sont celles de la maquette, en attendant un vrai fonds : rien n'est branche sur une source.
 * Les trois statuts (donnee, interpretation, opinion) et l'archive vivante viennent de l'engagement du projet,
 * separer ce qui se mesure de ce qui se discute.
 */
import { isMapNavigator, type SelectedPlace } from '@graphics/universes/MapNavigator.interface.ts'

type Status = 'donnee' | 'interpretation' | 'opinion' | 'vivante'

interface Entry {
  status: Status
  date: string
  source: string
  title: string
  note: string
}

const TABS = ['Presse', 'Scrutins', 'Personnalités']
/** Contenu de demonstration, repris de la maquette : aucune de ces entrees ne vient d'un fonds reel. */
const SAMPLE: Entry[] = [
  {
    status: 'donnee',
    date: '14 mars 1968',
    source: 'Le Parisien libéré',
    title: "Renault annonce la fermeture de l'île Seguin",
    note: 'Une du 14 mars, colonne 1. Coupure numérisée, fonds départemental.',
  },
  {
    status: 'interpretation',
    date: 'Municipales 2020',
    source: "Ministère de l'Intérieur",
    title: 'Participation en baisse de 19 points sur deux scrutins',
    note: 'Comparaison 2014 et 2020, même périmètre communal. Méthode publiée.',
  },
  {
    status: 'donnee',
    date: '2 juin 1995',
    source: 'Antenne 2, journal de 20 h',
    title: 'Reportage sur les friches industrielles du Trapèze',
    note: 'Sujet de 3 min 40. Notice INA, consultation sur place.',
  },
  {
    status: 'vivante',
    date: 'Hier, 18 h 40',
    source: 'Agence France-Presse',
    title: 'Le conseil municipal vote le réaménagement des quais',
    note: "Entrée dans l'archive vivante. Elle sera consultable demain dans le fonds.",
  },
]

/** Le panneau se range quand le territoire quitte la vue : on ne lit pas Lyon en regardant Marseille. */
const AWAY = 1.2
/** Duree du comptage des chiffres. */
const COUNT_MS = 900
/**
 * Duree de l'effacement de la feuille (`PanelNode`, `ERASE_MS`) : le panneau reste monte jusqu'au bout, sinon
 * son texte disparaitrait d'un coup sous une feuille qui se consume encore.
 */
const LEAVE_MS = 700
/**
 * Le texte s'efface d'abord, en cette duree, et la feuille ne se consume qu'ensuite : la transition de chaque
 * bloc (300 ms) laissait sinon le texte flotter sur la carte, la feuille deja partie sous lui.
 */
const TEXT_OUT_MS = 200
/** Changement de territoire, panneau ouvert : la feuille reste, le texte se reecrit en cette duree. */
const SWAP_MS = 700
/** Seuil d'ecriture de chaque bloc : il apparait quand la feuille en est la (`--fonds-reveal`). */
const AT = { head: 0.22, tabs: 0.34, list: 0.42, step: 0.07, foot: 0.72 }

const place = ref<SelectedPlace | null>(null)
const tab = ref(TABS[0])
const leaving = ref(false)
/** Fermeture demandee : le texte part, la feuille attend. */
const closing = ref(false)
const archives = ref(0)
const panel = ref<HTMLElement | null>(null)
let unsubscribe: (() => void) | null = null
let watcher = 0
let counting = 0
let swapping = 0
let unmount = 0

/** Le panneau est un aperçu : le fonds complet n'existe pas encore, ces chiffres sont ceux de la maquette. */
const counts = { archives: 318, period: '1961 · 2026', media: '14' }

function navigator() {
  const universes = useThreeStage().read()?.runtime.output.getActiveUniverses() ?? []
  return universes.find(isMapNavigator) ?? null
}

/** Les chiffres se remplissent plutot que d'apparaitre : le fonds se compte sous les yeux. */
function count() {
  const start = performance.now()
  cancelAnimationFrame(counting)
  const step = () => {
    const t = Math.min(1, (performance.now() - start) / COUNT_MS)
    archives.value = Math.round(counts.archives * (1 - (1 - t) ** 3))
    if (t < 1) counting = requestAnimationFrame(step)
  }
  counting = requestAnimationFrame(step)
}

/** Le texte se reecrit sans que la feuille ne bouge : `--swap` remonte de 0 a 1, et borne l'ecriture. */
function swap() {
  const start = performance.now()
  cancelAnimationFrame(swapping)
  const step = () => {
    const t = Math.min(1, (performance.now() - start) / SWAP_MS)
    panel.value?.style.setProperty('--swap', t.toFixed(3))
    if (t < 1) swapping = requestAnimationFrame(step)
  }
  swapping = requestAnimationFrame(step)
}

function open(next: SelectedPlace) {
  const wasOpen = !!place.value && !leaving.value && !closing.value
  clearTimeout(unmount)
  closing.value = false
  leaving.value = false
  place.value = next
  tab.value = TABS[0]
  archives.value = 0
  count()
  if (wasOpen) swap()
}

/** Le texte s'efface, puis la feuille se consume, puis le panneau s'en va : jusque-la il reste monte. */
function close() {
  if (!place.value || closing.value || leaving.value) return
  closing.value = true
  clearTimeout(unmount)
  unmount = window.setTimeout(() => {
    leaving.value = true
    unmount = window.setTimeout(() => {
      place.value = null
      closing.value = false
      leaving.value = false
    }, LEAVE_MS)
  }, TEXT_OUT_MS)
}

/** Le territoire est-il encore sous les yeux ? Sinon, le panneau se range tout seul. */
function watch() {
  const at = navigator()?.readout()
  const here = place.value
  // En vol, la vue se resserre avant d'arriver : le lieu vise parait loin alors qu'on y va.
  if (!at || !here || at.flying) return
  const away = Math.hypot((here.lon - at.lon) * Math.cos((at.lat * Math.PI) / 180), here.lat - at.lat) * 111.32
  if (away > at.extentKm * AWAY) close()
}

// L'interface se range a gauche du panneau tant qu'il est la (`chrome.css`) ; elle ne revient qu'une fois la
// feuille consumee, sinon elle s'ecrirait par-dessus.
watchEffect(() => document.documentElement.toggleAttribute('data-fonds-open', !!place.value))

onMounted(() => {
  unsubscribe = navigator()?.onPlaceSelected(open) ?? null
  watcher = window.setInterval(watch, 400)
})

onBeforeUnmount(() => {
  document.documentElement.removeAttribute('data-fonds-open')
  unsubscribe?.()
  clearInterval(watcher)
  clearTimeout(unmount)
  cancelAnimationFrame(counting)
  cancelAnimationFrame(swapping)
})

defineExpose({ place })
</script>

<template>
  <aside
    v-if="place"
    ref="panel"
    data-fonds
    :data-state="leaving ? 'leave' : 'enter'"
    class="fonds"
    :class="{ 'is-closing': closing }"
    aria-label="Fonds du territoire"
  >
    <header class="fonds__head" :style="{ '--at': AT.head }">
      <div class="fonds__top">
        <span class="fonds__code">Fonds {{ place.name.slice(0, 3).toUpperCase() }}-012</span>
        <button type="button" class="fonds__close" aria-label="Fermer le fonds" @click="close">×</button>
      </div>
      <h2 class="fonds__name">{{ place.name }}</h2>
      <div class="fonds__figures">
        <div><span>Archives</span><b>{{ archives }}</b></div>
        <div><span>Période</span><b>{{ counts.period }}</b></div>
        <div><span>Médias</span><b>{{ counts.media }}</b></div>
      </div>
    </header>

    <nav class="fonds__tabs" aria-label="Type d'archive" :style="{ '--at': AT.tabs }">
      <div>
        <button
          v-for="name in TABS"
          :key="name"
          type="button"
          :class="{ 'is-active': name === tab }"
          @click="tab = name"
        >
          {{ name }}
        </button>
      </div>
      <span>Tri · date</span>
    </nav>

    <ol class="fonds__list">
      <li
        v-for="(entry, i) in SAMPLE"
        :key="entry.title"
        :class="{ 'is-shaded': entry.status === 'interpretation' }"
        :style="{ '--at': AT.list + i * AT.step }"
      >
        <div class="fonds__meta" :class="{ 'is-live': entry.status === 'vivante' }">
          <i :class="`is-${entry.status}`" />
          <span>{{ entry.date }}</span>
          <span class="fonds__slash">/</span>
          <span>{{ entry.source }}</span>
        </div>
        <h3>{{ entry.title }}</h3>
        <p>{{ entry.note }}</p>
      </li>
    </ol>

    <footer class="fonds__foot" :style="{ '--at': AT.foot }">
      <span>{{ SAMPLE.length }} de {{ counts.archives }}</span>
      <span class="fonds__all">Tout le fonds<i /></span>
    </footer>
  </aside>
</template>

<style scoped>
.fonds {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 5;
  display: flex;
  flex-direction: column;
  width: var(--fonds-width);
  color: rgb(var(--ui-ink));
  pointer-events: auto;
}

/*
 * Pas de fond ni de bordure ici : la feuille est un plan WebGL cale sur ce rectangle (`PanelNode`), qui s'ecrit
 * par taches avec un bord d'encre et se consume a la fermeture. Il pose `--fonds-reveal` sur cet element ;
 * chaque bloc bascule quand le front atteint son seuil (`--at`) — `--in` vaut alors 0 ou 1 — et c'est la
 * transition qui l'anime, en 300 ms : suivre le front directement le faisait passer en 150 ms. `--swap` fait
 * reecrire le texte quand on change de territoire sans refermer.
 */
.fonds__list li,
.fonds__head,
.fonds__tabs,
.fonds__foot {
  --in: clamp(0, calc((min(var(--fonds-reveal, 0), var(--swap, 1)) - var(--at, 0)) * 1000), 1);
  opacity: var(--in);
  translate: 0 calc((1 - var(--in)) * 10px);
  transition:
    opacity 300ms ease,
    translate 300ms cubic-bezier(0.16, 1, 0.3, 1);
}

/* Fermeture : tout le texte part ensemble, vite, avant que la feuille ne se consume. */
.fonds.is-closing .fonds__list li,
.fonds.is-closing .fonds__head,
.fonds.is-closing .fonds__tabs,
.fonds.is-closing .fonds__foot {
  opacity: 0;
  translate: 0 6px;
  transition-duration: 200ms;
}

@media (prefers-reduced-motion: reduce) {
  .fonds__list li,
  .fonds__head,
  .fonds__tabs,
  .fonds__foot {
    transition: none;
  }
}

.fonds__head {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 34px 36px 22px;
  border-bottom: 1px solid rgb(var(--ui-ink) / 0.22);
}

.fonds__top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}

.fonds__code {
  font: 500 0.625rem/1 var(--font-map);
  letter-spacing: 0.35em;
  text-transform: uppercase;
  color: rgb(var(--ui-ink) / 0.62);
}

.fonds__close {
  padding: 0;
  border: 0;
  background: none;
  color: rgb(var(--ui-ink) / 0.66);
  font: 500 1rem/1 var(--font-map);
  cursor: pointer;
}

.fonds__close:hover {
  color: var(--ui-accent);
}

.fonds__name {
  margin: 0;
  font: 400 clamp(1.5rem, 3vw, 2.125rem)/1.1 var(--font-voice);
}

.fonds__figures {
  display: flex;
  gap: 26px;
}

.fonds__figures div {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.fonds__figures span {
  font: 500 0.5625rem/1 var(--font-map);
  letter-spacing: 0.3em;
  text-transform: uppercase;
  color: rgb(var(--ui-ink) / 0.58);
}

.fonds__figures b {
  font: 600 1.0625rem/1 var(--font-map);
}

.fonds__tabs {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 36px 14px;
  border-bottom: 1px solid rgb(var(--ui-ink) / 0.16);
  font: 500 0.625rem/1 var(--font-map);
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: rgb(var(--ui-ink) / 0.58);
}

.fonds__tabs div {
  display: flex;
  gap: 20px;
}

.fonds__tabs button {
  padding: 0 0 5px;
  border: 0;
  border-bottom: 1px solid transparent;
  background: none;
  color: rgb(var(--ui-ink) / 0.58);
  font: inherit;
  letter-spacing: inherit;
  text-transform: inherit;
  cursor: pointer;
}

.fonds__tabs button.is-active {
  border-bottom-color: rgb(var(--ui-ink));
  color: rgb(var(--ui-ink));
}

.fonds__list {
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}

.fonds__list li {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 18px 36px;
  border-bottom: 1px solid rgb(var(--ui-ink) / 0.16);
}

.fonds__list li.is-shaded {
  background: rgb(var(--ui-ink) / 0.035);
}

.fonds__meta {
  display: flex;
  align-items: center;
  gap: 10px;
  font: 500 0.5625rem/1 var(--font-map);
  letter-spacing: 0.28em;
  text-transform: uppercase;
  color: rgb(var(--ui-ink) / 0.62);
}

.fonds__meta.is-live {
  color: var(--ui-accent);
}

.fonds__slash {
  color: rgb(var(--ui-ink) / 0.58);
}

.fonds__meta.is-live .fonds__slash {
  color: inherit;
  opacity: 0.45;
}

/* Les quatre marqueurs de statut : ce qui se mesure, ce qui se compare, ce qui se juge, ce qui arrive. */
.fonds__meta i {
  width: 8px;
  height: 8px;
  flex: none;
}

.fonds__meta i.is-donnee {
  background: rgb(var(--ui-ink));
}

.fonds__meta i.is-interpretation {
  border: 1px solid rgb(var(--ui-ink) / 0.7);
}

.fonds__meta i.is-opinion {
  border: 1px solid rgb(var(--ui-ink) / 0.4);
  background-image: repeating-linear-gradient(45deg, rgb(var(--ui-ink) / 0.8) 0 1px, transparent 1px 3px);
}

.fonds__meta i.is-vivante {
  border-radius: 50%;
  background: var(--ui-accent);
}

.fonds__list h3 {
  margin: 0;
  font: 400 1.3125rem/1.25 var(--font-voice);
}

.fonds__list p {
  margin: 0;
  font: 400 0.75rem/1.6 var(--font-map);
  color: rgb(var(--ui-ink) / 0.6);
}

.fonds__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 36px;
  border-top: 1px solid rgb(var(--ui-ink) / 0.22);
  font: 500 0.625rem/1 var(--font-map);
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: rgb(var(--ui-ink) / 0.58);
}

.fonds__all {
  display: flex;
  align-items: center;
  gap: 12px;
  color: rgb(var(--ui-ink));
}

.fonds__all i {
  width: 26px;
  height: 1px;
  background: rgb(var(--ui-ink));
}
</style>
