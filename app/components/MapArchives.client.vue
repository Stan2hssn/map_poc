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

const place = ref<SelectedPlace | null>(null)
const tab = ref(TABS[0])
let unsubscribe: (() => void) | null = null

/** Le panneau est un aperçu : le fonds complet n'existe pas encore, ces chiffres sont ceux de la maquette. */
const counts = { archives: '318', period: '1961 · 2026', media: '14' }

function open(next: SelectedPlace) {
  place.value = next
  tab.value = TABS[0]
}

onMounted(() => {
  const universes = useThreeStage().read()?.runtime.output.getActiveUniverses() ?? []
  unsubscribe = universes.find(isMapNavigator)?.onPlaceSelected(open) ?? null
})

onBeforeUnmount(() => unsubscribe?.())

defineExpose({ place })
</script>

<template>
  <aside v-if="place" class="fonds" aria-label="Fonds du territoire">
    <header class="fonds__head">
      <div class="fonds__top">
        <span class="fonds__code">Fonds {{ place.name.slice(0, 3).toUpperCase() }}-012</span>
        <button type="button" class="fonds__close" aria-label="Fermer le fonds" @click="place = null">×</button>
      </div>
      <h2 class="fonds__name">{{ place.name }}</h2>
      <div class="fonds__figures">
        <div><span>Archives</span><b>{{ counts.archives }}</b></div>
        <div><span>Période</span><b>{{ counts.period }}</b></div>
        <div><span>Médias</span><b>{{ counts.media }}</b></div>
      </div>
    </header>

    <nav class="fonds__tabs" aria-label="Type d'archive">
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
      <li v-for="entry in SAMPLE" :key="entry.title" :class="{ 'is-shaded': entry.status === 'interpretation' }">
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

    <footer class="fonds__foot">
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
  width: min(452px, 92vw);
  background: rgb(var(--ui-paper) / 0.97);
  border-left: 1px solid rgb(var(--ui-ink) / 0.3);
  color: rgb(var(--ui-ink));
  pointer-events: auto;
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
