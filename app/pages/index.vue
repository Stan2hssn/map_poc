<script setup lang="ts">
/**
 * Entree : une page presque vide. Tout ce qu'elle montre — le papier hachure, le cercle autour du curseur et
 * le mot a poser — est dessine dans le rendu (`IntroNode`), pour que le depart de l'experience puisse tout
 * retirer d'un seul geste, par taches depuis le centre. Un calque HTML ne saurait pas disparaitre ainsi.
 *
 * Ne restent ici que les mentions de pied de page, qui ne participent pas a ce geste.
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
  if (drawn.value) return
  const map = navigator()
  map?.holdIntro()
  map?.setIntroReady(true)
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

/* Le curseur est remplace par le cercle dessine dans le rendu. */
:global(html[data-map-intro='hold']) {
  cursor: none;
}

.entry {
  position: fixed;
  inset: 0;
  z-index: 4;
  color: rgb(var(--ui-ink));
  pointer-events: none;
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
  .entry__gauge i {
    transition: none;
  }
}
</style>
