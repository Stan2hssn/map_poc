<script setup lang="ts">
/**
 * Entree : une page presque vide, dans l'esprit des references. La carte se charge derriere, sans rien
 * dessiner ; au clic elle s'ouvre depuis le centre et se pose sur la France.
 *
 * La masse d'encre de la maquette est ici le rendu lui-meme au repos (papier et quelques hachures, poses par
 * la passe d'encre), fondu par le meme lavis : rien n'est dessine en double.
 */
import { MAP_VIEWS } from '@graphics/config/views.config.ts'
import { isMapNavigator } from '@graphics/universes/MapNavigator.interface.ts'

const started = ref(false)
const drawn = ref(false)

function navigator() {
  const universes = useThreeStage().read()?.runtime.output.getActiveUniverses() ?? []
  return universes.find(isMapNavigator) ?? null
}

function onReady() {
  started.value = true
  if (!drawn.value) navigator()?.holdIntro()
}

function draw() {
  if (drawn.value || !started.value) return
  drawn.value = true
  document.documentElement.dataset.mapIntro = 'drawn'
  navigator()?.drawMap(MAP_VIEWS.france)
}

onMounted(() => {
  document.documentElement.dataset.mapIntro = 'hold'
})

onBeforeUnmount(() => {
  delete document.documentElement.dataset.mapIntro
})
</script>

<template>
  <main class="shell" @pointerdown="draw">
    <ThreeStage @ready="onReady" />
    <MapChrome v-if="drawn" />
    <MapArchives v-if="drawn" />

    <div v-if="!drawn" class="entry">
      <!-- Papier journal et lavis : ils protegent la lisibilite sans effacer ce qui est dessine dessous. -->
      <div class="entry__paper" />
      <div class="entry__wash" />

      <div class="entry__title">
        <p class="entry__over">Fonds médiatique et politique</p>
        <h1 class="entry__wordmark">ARCHIVES</h1>
        <p class="entry__dates">France · 1958 à 2027</p>
      </div>

      <p class="entry__question">La même France raconte-t-elle<br>la même histoire politique&nbsp;?</p>

      <div class="entry__enter" :class="{ 'is-ready': started }">
        <button type="button" @click="draw">Entrer</button>
        <i />
      </div>

      <nav class="entry__links" aria-label="Pied de page">
        <span class="entry__langs"><b>FR</b><i>EN</i></span>
        <span>Méthode</span>
        <span>Mentions</span>
      </nav>

      <div class="entry__loading">
        <div class="entry__gauge"><i :class="{ 'is-full': started }" /></div>
        <span>{{ started ? 'Fonds prêt' : 'Fonds en chargement' }}</span>
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

.entry {
  position: fixed;
  inset: 0;
  z-index: 4;
  color: rgb(var(--ui-ink));
  pointer-events: none;
}

.entry__paper {
  position: absolute;
  inset: 0;
  background: url('/assets/Images/Paper/newspaper.webp') 22% 14% / 1200px auto;
  opacity: 0.42;
  mix-blend-mode: multiply;
}

/* Lavis elliptique centre sur la colonne de texte. */
.entry__wash {
  position: absolute;
  inset: 0;
  background: radial-gradient(
    44% 60% at 50% 46%,
    rgb(244 240 230 / 0.95) 0%,
    rgb(244 240 230 / 0.9) 58%,
    rgb(244 240 230 / 0.25) 88%,
    rgb(244 240 230 / 0) 100%
  );
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

.entry__over {
  margin: 0;
  padding-left: 0.52em;
  font: 500 0.6875rem/1 var(--font-map);
  letter-spacing: 0.52em;
  text-transform: uppercase;
  color: rgb(var(--ui-ink) / 0.62);
}

.entry__wordmark {
  margin: 0;
  padding-left: 0.3em;
  font: 500 clamp(1.75rem, 3vw, 2.5rem)/1 var(--font-voice);
  letter-spacing: 0.3em;
}

.entry__dates {
  margin: 0;
  padding-left: 0.3em;
  font: 400 0.75rem/1 var(--font-map);
  letter-spacing: 0.3em;
  text-transform: uppercase;
  color: rgb(var(--ui-ink) / 0.64);
}

.entry__question {
  position: absolute;
  top: 46vh;
  left: 50%;
  width: min(1000px, 78vw);
  margin: 0;
  translate: -50% 0;
  text-align: center;
  font: 400 clamp(0.9rem, 1.35vw, 1.3125rem)/2.1 var(--font-map);
  letter-spacing: 0.27em;
  text-transform: uppercase;
}

.entry__enter {
  position: absolute;
  top: 72vh;
  left: 50%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 22px;
  translate: -50% 0;
  opacity: 0;
  transition: opacity 700ms ease;
}

/* Rien n'invite a entrer tant que la carte n'est pas prete a s'ouvrir. */
.entry__enter.is-ready {
  opacity: 1;
}

.entry__enter button {
  padding: 0 0 0 0.24em;
  border: 0;
  background: none;
  color: var(--ui-accent);
  font: 400 1.5rem/1 var(--font-voice);
  letter-spacing: 0.24em;
  cursor: pointer;
  pointer-events: auto;
}

/* Filet qui descend et s'efface : l'invitation a plonger. */
.entry__enter i {
  width: 1px;
  height: 54px;
  background: linear-gradient(to bottom, var(--ui-accent), rgb(179 69 47 / 0));
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
  width: 18%;
  height: 100%;
  background: rgb(var(--ui-ink) / 0.55);
  transition: width 900ms ease;
}

.entry__gauge i.is-full {
  width: 100%;
}

@media (prefers-reduced-motion: reduce) {
  .entry__enter,
  .entry__gauge i {
    transition: none;
  }
}
</style>
