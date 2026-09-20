<script setup lang="ts">
/**
 * Chrome de la carte : voile de papier, en-tete, rail des niveaux, releves, frise et attribution.
 * Il se pose sur le rendu, il ne le touche pas.
 *
 * Le rail est le commutateur de niveau (ce que la carte nomme). Le fil d'Ariane, lui, ne commande rien : il
 * dit ou l'on se trouve et se remplit a mesure qu'on descend, donc regarder Marseille en ayant ouvert le
 * fonds de Lyon affiche bien Marseille.
 */
import { MAP_VIEWS } from '@graphics/config/views.config.ts'
import { MAP_FOCUS, type MapFocusId } from '@graphics/config/focus.config.ts'
import { isMapNavigator, type SelectedPlace } from '@graphics/universes/MapNavigator.interface.ts'

/** Longueur visee de la barre d'echelle, en pixels. */
const SCALE_PX = 148
/** Rafraichissement des releves. */
const READ_MS = 200
/** Au-dela de ces largeurs de vue (km), le niveau n'est pas atteint et n'entre pas dans le fil d'Ariane. */
const CRUMB_KM = { region: 600, departement: 150, ville: 25 }
/** Le releve inverse ne part qu'apres ce repos, et seulement si le point vise a bouge d'autant (degres). */
const LOOKUP_MS = 500
const LOOKUP_DEG = 0.02
/** Hauteurs de la frise ; la derniere barre est l'archive vivante. */
const BARS = [22, 31, 26, 44, 38, 57, 49, 68, 61, 83, 72, 94, 78, 100]
const FIRST_YEAR = 1958
const LAST_YEAR = 2027
/** Niveaux, dans l'ordre du rail : c'est le commutateur de ce que la carte nomme. */
const LEVELS: { rank: string; id: MapFocusId }[] = [
  { rank: '01', id: 'communes' },
  { rank: '02', id: 'departements' },
  { rank: '03', id: 'regions' },
]

const focus = ref<MapFocusId>('communes')
const scale = ref({ label: '', width: SCALE_PX })
const coords = ref({ lat: '', lon: '' })
const where = ref({ region: '', departement: '', ville: '' })
const extentKm = ref(0)
const query = ref('')
const hits = ref<SelectedPlace[]>([])
/** Periode retenue sur la frise : deux bornes d'annees. */
const period = ref<[number, number]>([FIRST_YEAR, LAST_YEAR])
let timer = 0
let lookup = 0
let lastAt = { lon: 999, lat: 999 }

function navigator() {
  const universes = useThreeStage().read()?.runtime.output.getActiveUniverses() ?? []
  return universes.find(isMapNavigator) ?? null
}

/** Fil d'Ariane : une entree par niveau atteint, la derniere a pleine encre. */
const crumbs = computed(() => {
  const trail = [{ label: 'France', key: 'france' }]
  const at = where.value
  if (extentKm.value <= CRUMB_KM.region && at.region) trail.push({ label: at.region, key: 'region' })
  if (extentKm.value <= CRUMB_KM.departement && at.departement) trail.push({ label: at.departement, key: 'departement' })
  if (extentKm.value <= CRUMB_KM.ville && at.ville) trail.push({ label: at.ville, key: 'ville' })
  return trail
})

const periodLabel = computed(() => (period.value[0] === period.value[1] ? `${period.value[0]}` : `${period.value[0]} – ${period.value[1]}`))

function setFocus(id: MapFocusId) {
  focus.value = id
  navigator()?.setFocus(id)
}

/** Distance ronde (1, 2 ou 5 fois une puissance de dix) la plus proche de `SCALE_PX` a l'ecran. */
function niceScale(km: number) {
  const perKm = window.innerWidth / Math.max(1e-6, km)
  const raw = SCALE_PX / perKm
  const power = 10 ** Math.floor(Math.log10(Math.max(1e-6, raw)))
  const rounded = ([1, 2, 5, 10].find((s) => raw <= s * power) ?? 10) * power
  const label = rounded >= 1 ? `${Math.round(rounded)} km` : `${Math.round(rounded * 1000)} m`
  return { label, width: Math.min(SCALE_PX * 1.6, rounded * perKm) }
}

/** Degres et minutes, comme les coordonnees portees en marge de la carte. */
function degrees(value: number, axis: 'lat' | 'lon') {
  const hemisphere = axis === 'lat' ? (value >= 0 ? 'N' : 'S') : value >= 0 ? 'E' : 'O'
  const total = Math.abs(value)
  const whole = Math.floor(total)
  return `${whole}°${String(Math.round((total - whole) * 60)).padStart(2, '0')}'${hemisphere}`
}

/** Ou l'on se trouve : commune, departement et region du point vise, en un appel. */
async function locate(lon: number, lat: number) {
  try {
    const url = `https://geo.api.gouv.fr/communes?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}&fields=nom,departement,region&format=json`
    const found = (await (await fetch(url)).json()) as { nom?: string; departement?: { nom: string }; region?: { nom: string } }[]
    const at = found[0]
    where.value = { region: at?.region?.nom ?? '', departement: at?.departement?.nom ?? '', ville: at?.nom ?? '' }
  } catch {
    // Hors de France, ou reseau absent : le fil s'arrete a ce qu'il sait.
    where.value = { region: '', departement: '', ville: '' }
  }
}

function read() {
  const at = navigator()?.readout()
  if (!at) return
  extentKm.value = at.extentKm
  scale.value = niceScale(at.extentKm)
  coords.value = { lat: degrees(at.lat, 'lat'), lon: degrees(at.lon, 'lon') }
  if (Math.abs(at.lon - lastAt.lon) < LOOKUP_DEG && Math.abs(at.lat - lastAt.lat) < LOOKUP_DEG) return
  lastAt = { lon: at.lon, lat: at.lat }
  clearTimeout(lookup)
  lookup = window.setTimeout(() => void locate(at.lon, at.lat), LOOKUP_MS)
}

function onSearch() {
  hits.value = query.value.trim().length > 1 ? (navigator()?.searchPlaces(query.value, 6) ?? []) : []
}

function choose(place: SelectedPlace) {
  navigator()?.goToPlace(place)
  query.value = ''
  hits.value = []
}

const barYear = (index: number) => Math.round(FIRST_YEAR + ((LAST_YEAR - FIRST_YEAR) * index) / (BARS.length - 1))
const inPeriod = (index: number) => barYear(index) >= period.value[0] && barYear(index) <= period.value[1]

/** Frise : la premiere barre cliquee ouvre la plage, la seconde la ferme. */
function pickBar(index: number) {
  const year = barYear(index)
  const [from, to] = period.value
  period.value = from !== to || year < from ? [year, year] : [from, year]
}

onMounted(() => {
  read()
  timer = window.setInterval(read, READ_MS)
})

onBeforeUnmount(() => {
  clearInterval(timer)
  clearTimeout(lookup)
})
</script>

<template>
  <div class="chrome">
    <!-- Voile de papier sous l'interface : sans lui, les petits caracteres se perdent dans les hachures. -->
    <div class="chrome__veil" />

    <header class="chrome__head">
      <div class="chrome__brand">
        <button type="button" class="chrome__wordmark" @click="navigator()?.flyTo(MAP_VIEWS.france)">ARCHIVES</button>
        <div class="chrome__rule" />
        <nav class="chrome__crumbs" aria-label="Position">
          <template v-for="(crumb, i) in crumbs" :key="crumb.key">
            <span v-if="i" class="chrome__slash">/</span>
            <span :class="{ 'is-here': i === crumbs.length - 1 }">{{ crumb.label }}</span>
          </template>
        </nav>
      </div>

      <label class="chrome__search">
        <span />
        <input
          v-model="query"
          type="search"
          placeholder="Chercher un territoire"
          aria-label="Chercher un territoire"
          @input="onSearch"
          @keydown.enter.prevent="hits[0] && choose(hits[0])"
          @keydown.esc="hits = []"
        >
        <ul v-if="hits.length" class="chrome__hits">
          <li v-for="hit in hits" :key="`${hit.name}${hit.lon}`">
            <button type="button" @mousedown.prevent="choose(hit)">{{ hit.name }}</button>
          </li>
        </ul>
      </label>
    </header>

    <nav class="chrome__rail" aria-label="Niveau">
      <div class="chrome__tech">Trois regards</div>
      <button
        v-for="level in LEVELS"
        :key="level.id"
        type="button"
        class="chrome__look"
        :class="{ 'is-active': focus === level.id }"
        :aria-pressed="focus === level.id"
        @click="setFocus(level.id)"
      >
        <i />
        <b>{{ level.rank }}</b>
        <em>{{ MAP_FOCUS[level.id].label }}</em>
      </button>
    </nav>

    <!-- Une seule rangee en bas : les blocs se serrent au lieu de se chevaucher. -->
    <div class="chrome__foot">
      <div class="chrome__survey">
        <div class="chrome__scale">
          <div class="chrome__tech">{{ scale.label }}</div>
          <div :style="{ width: `${scale.width}px` }"><i /><i /></div>
        </div>
        <div class="chrome__coords">
          <div>{{ coords.lat }}</div>
          <div>{{ coords.lon }}</div>
        </div>
        <div class="chrome__legend">
          <div class="chrome__tech">Légende</div>
          <div>
            <span><i class="is-donnee" />Donnée</span>
            <span><i class="is-interpretation" />Interprétation</span>
            <span><i class="is-opinion" />Opinion</span>
          </div>
        </div>
      </div>

      <section class="chrome__timeline">
        <header>
          <div class="chrome__tech">{{ periodLabel }}</div>
          <button type="button" class="chrome__live" @click="period = [FIRST_YEAR, LAST_YEAR]">
            <i />Direct {{ LAST_YEAR }}
          </button>
        </header>
        <div class="chrome__bars">
          <button
            v-for="(h, i) in BARS"
            :key="i"
            type="button"
            :class="{ 'is-live': i === BARS.length - 1, 'is-out': !inPeriod(i) }"
            :style="{ height: `${h}%` }"
            :aria-label="String(barYear(i))"
            @click="pickBar(i)"
          />
        </div>
        <hr>
        <div class="chrome__decades">
          <span>{{ FIRST_YEAR }}</span><span>1981</span><span>2007</span><span class="is-live">{{ LAST_YEAR }}</span>
        </div>
      </section>

      <div class="chrome__credit">Relief RGE ALTI · Plan IGN<br>Licence Ouverte Etalab 2.0</div>
    </div>
  </div>
</template>
