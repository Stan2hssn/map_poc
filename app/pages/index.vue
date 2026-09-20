<script setup lang="ts">
/**
 * Intro : la page reste du papier nu, une annotation suit la souris, et au clic la carte se dessine en
 * s'ouvrant depuis le centre avant de se poser sur la France. La scene se charge pendant ce temps : au clic,
 * le relief et le plan sont deja la.
 */
import { MAP_VIEWS } from '@graphics/config/views.config.ts'
import { isMapNavigator } from '@graphics/universes/MapNavigator.interface.ts'

/** Temps de reponse (ms) de l'annotation vers la souris : elle suit, elle ne colle pas. */
const FOLLOW_MS = 120

const started = ref(false)
const drawn = ref(false)
/** L'annotation n'apparait qu'a l'entree de la souris dans la page. */
const hovered = ref(false)
const note = ref<HTMLElement | null>(null)
/** Avant le premier mouvement, l'annotation attend au milieu de la page. */
const pointer = { x: 0, y: 0, atX: 0, atY: 0, seen: false }
let frame = 0

function navigator() {
  const universes = useThreeStage().read()?.runtime.output.getActiveUniverses() ?? []
  return universes.find(isMapNavigator) ?? null
}

function onReady() {
  started.value = true
  if (!drawn.value) navigator()?.holdIntro()
}

function onMove(event: PointerEvent) {
  hovered.value = true
  pointer.x = event.clientX
  pointer.y = event.clientY
  if (pointer.seen) return
  pointer.seen = true
  pointer.atX = pointer.x
  pointer.atY = pointer.y
}

function draw() {
  if (drawn.value || !started.value) return
  drawn.value = true
  document.documentElement.dataset.mapIntro = 'drawn'
  navigator()?.drawMap(MAP_VIEWS.france)
}

/** Suivi amorti de la souris : une annotation qui rattrape le curseur, comme tracee a la main. */
function follow(previous: number, now: number) {
  const k = 1 - Math.exp(-(now - previous) / FOLLOW_MS)
  pointer.atX += (pointer.x - pointer.atX) * k
  pointer.atY += (pointer.y - pointer.atY) * k
  if (note.value) note.value.style.transform = `translate3d(${pointer.atX}px, ${pointer.atY}px, 0)`
  frame = requestAnimationFrame((next) => follow(now, next))
}

onMounted(() => {
  pointer.x = pointer.atX = window.innerWidth / 2
  pointer.y = pointer.atY = window.innerHeight / 2
  document.documentElement.dataset.mapIntro = 'hold'
  frame = requestAnimationFrame((now) => follow(now, now))
})

onBeforeUnmount(() => {
  cancelAnimationFrame(frame)
  delete document.documentElement.dataset.mapIntro
})
</script>

<template>
  <main class="shell" @pointerenter="hovered = true" @pointermove="onMove" @pointerdown="draw">
    <ThreeStage @ready="onReady" />
    <MapFocus v-if="drawn" />
    <MapShortcuts v-if="drawn" />

    <p v-if="!drawn" ref="note" class="note" :class="{ 'is-ready': started && hovered }" aria-live="polite">
      <span>Click to draw the map</span>
    </p>
  </main>
</template>

<style scoped>
.shell {
  position: fixed;
  inset: 0;
  background: #f1ece0;
}

/* Posee au curseur par `follow` ; le decalage est dans la regle, pour ne pas le refaire a chaque image. */
.note {
  position: fixed;
  top: 0;
  left: 0;
  z-index: 4;
  margin: 0;
  opacity: 0;
  pointer-events: none;
  transition: opacity 600ms ease;
  will-change: transform;
}

.note.is-ready {
  opacity: 1;
}

.note span {
  display: block;
  transform: translate(1.25rem, -0.6rem);
  color: rgb(29 42 77 / 0.75);
  font: 400 0.9rem/1 var(--font-map);
  letter-spacing: 0.08em;
  white-space: nowrap;
}

@media (prefers-reduced-motion: reduce) {
  .note { transition: none; }
}
</style>
