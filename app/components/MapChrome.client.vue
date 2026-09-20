<script setup lang="ts">
/**
 * Chrome de la carte, d'apres les maquettes : en-tete et fil d'Ariane, rail des quatre regards, releves,
 * frise et attribution. Il se pose sur le rendu, il ne le touche pas.
 *
 * Le fil d'Ariane est le niveau de focus (`setFocus`) ; les trois autres regards et la frise sont dessines
 * mais inertes, faute de fonds d'archives.
 */
import { MAP_VIEWS } from '@graphics/config/views.config.ts'
import type { MapFocusId } from '@graphics/config/focus.config.ts'
import { isMapNavigator } from '@graphics/universes/MapNavigator.interface.ts'

/** Longueur visee de la barre d'echelle, en pixels. */
const SCALE_PX = 148
/** Rafraichissement des releves : l'echelle et les coordonnees n'ont pas besoin de chaque image. */
const READ_MS = 200
/** Hauteurs de la frise, en part de sa hauteur. La derniere est l'archive vivante. */
const BARS = [22, 31, 26, 44, 38, 57, 49, 68, 61, 83, 72, 94, 78, 100]
const DECADES = ['1958', '1970', '1981', '1995', '2007', '2017', '2027']
const LOOKS = [
  { rank: '01', label: 'Mediatique', ready: true },
  { rank: '02', label: 'Municipale', ready: false },
  { rank: '03', label: 'Europeenne', ready: false },
  { rank: '04', label: 'Presidentielle', ready: false },
]
/** Fil d'Ariane : le niveau de focus que chaque entree demande. `null` : retour a la vue France. */
const CRUMBS: { label: string; focus: MapFocusId | null }[] = [
  { label: 'France', focus: null },
  { label: 'Region', focus: 'regions' },
  { label: 'Departement', focus: 'departements' },
  { label: 'Ville', focus: 'communes' },
]

const focus = ref<MapFocusId | null>(null)
const scale = ref({ label: '', width: SCALE_PX })
const coords = ref({ lat: '', lon: '' })
const query = ref('')
let timer = 0

function navigator() {
  const universes = useThreeStage().read()?.runtime.output.getActiveUniverses() ?? []
  return universes.find(isMapNavigator) ?? null
}

function go(crumb: (typeof CRUMBS)[number]) {
  focus.value = crumb.focus
  if (!crumb.focus) navigator()?.flyTo(MAP_VIEWS.france)
  else navigator()?.setFocus(crumb.focus)
}

/** Distance ronde (1, 2 ou 5 fois une puissance de dix) la plus proche de `SCALE_PX` a l'ecran. */
function niceScale(extentKm: number) {
  const perKm = window.innerWidth / Math.max(1e-6, extentKm)
  const raw = SCALE_PX / perKm
  const power = 10 ** Math.floor(Math.log10(Math.max(1e-6, raw)))
  const steps = [1, 2, 5, 10]
  const km = (steps.find((s) => raw <= s * power) ?? 10) * power
  const label = km >= 1 ? `${Math.round(km)} km` : `${Math.round(km * 1000)} m`
  return { label, width: Math.min(SCALE_PX * 1.6, km * perKm) }
}

/** Degres et minutes, comme les coordonnees portees en marge de la carte. */
function degrees(value: number, axis: 'lat' | 'lon') {
  const hemisphere = axis === 'lat' ? (value >= 0 ? 'N' : 'S') : value >= 0 ? 'E' : 'O'
  const total = Math.abs(value)
  const whole = Math.floor(total)
  return `${whole}°${String(Math.round((total - whole) * 60)).padStart(2, '0')}'${hemisphere}`
}

function read() {
  const at = navigator()?.readout()
  if (!at) return
  scale.value = niceScale(at.extentKm)
  coords.value = { lat: degrees(at.lat, 'lat'), lon: degrees(at.lon, 'lon') }
}

onMounted(() => {
  read()
  timer = window.setInterval(read, READ_MS)
})

onBeforeUnmount(() => clearInterval(timer))
</script>

<template>
  <div class="chrome">
    <header class="chrome__head">
      <div class="chrome__brand">
        <div class="chrome__wordmark">ARCHIVES</div>
        <div class="chrome__rule" />
        <nav class="chrome__crumbs" aria-label="Niveau">
          <template v-for="(crumb, i) in CRUMBS" :key="crumb.label">
            <span v-if="i">/</span>
            <button
              type="button"
              class="chrome__crumb"
              :class="{ 'is-active': focus === crumb.focus }"
              :aria-current="focus === crumb.focus ? 'true' : undefined"
              @click="go(crumb)"
            >
              {{ crumb.label }}
            </button>
          </template>
        </nav>
      </div>

      <div class="chrome__tools">
        <label class="chrome__search">
          <span />
          <input v-model="query" type="search" placeholder="Chercher un territoire" aria-label="Chercher un territoire">
        </label>
        <div class="chrome__method">Methode</div>
      </div>
    </header>

    <nav class="chrome__rail" aria-label="Quatre regards">
      <div class="chrome__tech">Quatre regards</div>
      <button
        v-for="look in LOOKS"
        :key="look.rank"
        type="button"
        class="chrome__look"
        :class="{ 'is-active': look.ready }"
        :disabled="!look.ready"
      >
        <i />
        <b>{{ look.rank }}</b>
        <em>{{ look.label }}</em>
      </button>
    </nav>

    <div class="chrome__survey">
      <div class="chrome__scale">
        <div class="chrome__tech">{{ scale.label }}</div>
        <div :style="{ width: `${scale.width}px` }"><i /><i /></div>
      </div>
      <div class="chrome__coords">
        <div>{{ coords.lat }}</div>
        <div>{{ coords.lon }}</div>
      </div>
      <div class="chrome__compass">
        <b>N</b>
        <i />
        <s />
      </div>
    </div>

    <section class="chrome__timeline">
      <header>
        <div class="chrome__tech">Frise</div>
        <div class="chrome__live"><i />Direct 2027</div>
      </header>
      <div class="chrome__bars">
        <i v-for="(h, i) in BARS" :key="i" :class="{ 'is-live': i === BARS.length - 1 }" :style="{ height: `${h}%` }" />
      </div>
      <hr>
      <div class="chrome__decades"><span v-for="d in DECADES" :key="d">{{ d }}</span></div>
    </section>

    <div class="chrome__credit">
      <div>Relief RGE ALTI · Plan IGN<br>Licence Ouverte Etalab 2.0</div>
      <div class="chrome__loading"><i />Communes en cours</div>
    </div>
  </div>
</template>
