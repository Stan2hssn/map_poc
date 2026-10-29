<script setup lang="ts">
/**
 * Les textes de l'entree sont dessines par `IntroNode` a la place que leur donne ce HTML, pour que le masque
 * de composition les efface avec la page. On n'entre qu'une fois tout charge : des tuiles arrivees en plein
 * passage le feraient saccader.
 */
const LOAD_POLL_MS = 150
/** Delai apres « pret » avant de lever la feuille : le temps qu'une image de la page complete soit dessinee. */
const UNVEIL_DELAY_MS = 150

const loaded = ref(0)
const ready = ref(false)
const unveiled = ref(false)
const veilGone = ref(false)
const drawn = ref(false)
let poll = 0
let unveil = 0

function onReady() {
  if (drawn.value) return
  useMapNavigator()?.holdIntro()
  poll = window.setInterval(readLoad, LOAD_POLL_MS)
}

function readLoad() {
  const state = useMapNavigator()?.loadState()
  if (!state) return
  loaded.value = Math.max(loaded.value, state.progress)
  if (!state.ready) return
  loaded.value = 1
  ready.value = true
  useMapNavigator()?.setIntroReady(true)
  clearInterval(poll)
  unveil = window.setTimeout(() => (unveiled.value = true), UNVEIL_DELAY_MS)
}

function draw() {
  if (drawn.value || !ready.value) return
  drawn.value = true
  document.documentElement.dataset.mapIntro = 'drawn'
  useMapNavigator()?.drawMap()
}

onMounted(() => {
  document.documentElement.dataset.mapIntro = 'hold'
})

onBeforeUnmount(() => {
  clearInterval(poll)
  clearTimeout(unveil)
  delete document.documentElement.dataset.mapIntro
})
</script>

<template>
  <main class="shell" @pointerdown="draw">
    <ThreeStage @ready="onReady" />
    <MapChrome v-if="drawn" />
    <MapArchives v-if="drawn" />
    <MapCursor :mode="drawn ? 'map' : ready ? 'ready' : 'loading'" />

    <div
      v-if="!veilGone"
      class="loader"
      :class="{ 'is-done': unveiled }"
      role="status"
      aria-live="polite"
      @transitionend.self="veilGone = unveiled"
    >
      <div class="loader__inner">
        <div class="loader__gauge"><i :style="{ width: `${Math.round(loaded * 100)}%` }" /></div>
        <span class="loader__label">Fonds en chargement · {{ Math.round(loaded * 100) }} %</span>
      </div>
    </div>

    <div v-if="!drawn" class="entry">
      <!-- Mise en page seulement : l'encre de ces textes est posee par le rendu, qui sait les effacer. -->
      <div class="entry__title">
        <p data-intro-text class="entry__over">Fonds médiatique et politique</p>
        <h1 data-intro-text class="entry__wordmark">ARCHIVES</h1>
        <p data-intro-text class="entry__dates">France · 1958 à 2027</p>
      </div>

      <nav class="entry__links" aria-label="Pied de page">
        <span class="entry__langs"><b>FR</b><i>EN</i></span>
        <span>Méthode</span>
        <span>Mentions</span>
      </nav>

      <div class="entry__loading">
        <div class="entry__gauge"><i :style="{ width: `${Math.round(loaded * 100)}%` }" /></div>
        <span>{{ ready ? 'Fonds prêt' : `Fonds en chargement · ${Math.round(loaded * 100)} %` }}</span>
      </div>
    </div>
  </main>
</template>

<style scoped>
.shell {
  position: fixed;
  inset: 0;
  background: #f4f0e6;
}

/* Au-dessus de la page et de son pied, sous le cercle du curseur. Meme papier que la maquette d'entree. */
.loader {
  position: fixed;
  inset: 0;
  z-index: 10;
  display: grid;
  place-items: center;
  background: #f4f0e6;
  transition: opacity 700ms ease;
}

.loader::before {
  content: '';
  position: absolute;
  inset: 0;
  background: url('/assets/Images/Paper/newspaper.webp') 22% 14% / 1200px auto;
  opacity: 0.42;
  mix-blend-mode: multiply;
}

.loader.is-done {
  opacity: 0;
  pointer-events: none;
}

.loader__inner {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}

.loader__gauge {
  width: 120px;
  height: 1px;
  background: rgb(var(--ui-ink) / 0.16);
}

.loader__gauge i {
  display: block;
  width: 0;
  height: 100%;
  background: rgb(var(--ui-ink) / 0.62);
  transition: width 300ms ease;
}

.loader__label {
  padding-left: 0.3em;
  font: 500 0.625rem/1 var(--font-map);
  letter-spacing: 0.3em;
  text-transform: uppercase;
  color: rgb(var(--ui-ink) / 0.62);
}

.entry {
  position: fixed;
  inset: 0;
  z-index: 4;
  color: rgb(var(--ui-ink));
  pointer-events: none;
}

.entry__title {
  position: absolute;
  top: 18vh;
  left: 50%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 13px;
  translate: -50% 0;
  text-align: center;
}

/* Le texte garde sa couleur (le rendu y lit son opacite) mais ne la peint pas. */
.entry__title > * {
  margin: 0;
  -webkit-text-fill-color: transparent;
}

.entry__over {
  padding-left: 0.52em;
  font: 500 0.6875rem/1 var(--font-map);
  letter-spacing: 0.52em;
  text-transform: uppercase;
  color: rgb(var(--ui-ink) / 0.62);
}

.entry__wordmark {
  padding-left: 0.3em;
  font: 500 clamp(1.75rem, 3vw, 2.5rem)/1 var(--font-voice);
  letter-spacing: 0.3em;
  color: rgb(var(--ui-ink));
}

.entry__dates {
  padding-left: 0.3em;
  font: 400 0.75rem/1 var(--font-map);
  letter-spacing: 0.3em;
  text-transform: uppercase;
  color: rgb(var(--ui-ink) / 0.64);
}

.entry__links,
.entry__loading {
  position: absolute;
  bottom: 44px;
  display: flex;
  align-items: center;
  font: 500 0.625rem/1 var(--font-map);
  letter-spacing: 0.3em;
  text-transform: uppercase;
  color: rgb(var(--ui-ink) / 0.62);
}

.entry__links {
  left: 56px;
  gap: 34px;
}

.entry__langs {
  display: flex;
  align-items: center;
  gap: 14px;
}

.entry__langs b {
  font-weight: 500;
  color: var(--ui-accent);
}

.entry__langs i {
  font-style: normal;
  color: rgb(var(--ui-ink) / 0.64);
}

.entry__loading {
  right: 56px;
  gap: 12px;
}

.entry__gauge {
  width: 54px;
  height: 2px;
  background: rgb(var(--ui-ink) / 0.14);
}

.entry__gauge i {
  display: block;
  width: 0;
  height: 100%;
  background: rgb(var(--ui-ink) / 0.55);
  transition: width 300ms ease;
}

@media (prefers-reduced-motion: reduce) {
  .entry__gauge i,
  .loader,
  .loader__gauge i {
    transition: none;
  }
}
</style>
