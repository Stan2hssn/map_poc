<script setup lang="ts">
/** En HTML : dessine dans le rendu, il passerait sous le panneau et l'interface. `IntroNode` lit sa position. */
const props = defineProps<{ mode: 'loading' | 'ready' | 'map' }>()

const RADIUS = { loading: 30, ready: 44, map: 12, hover: 17, grab: 8 }
/** Temps de reponse du cercle au pointeur (ms) : il le rattrape sans y coller. */
const FOLLOW_MS = 55
const CLICKABLE = 'a, button, input, select, textarea, label, [role="button"]'
/** Harmoniques entieres : le trait se referme exactement sur son depart. */
const WOBBLE = [
  { k: 3, amp: 0.009, phase: 0.4 },
  { k: 5, amp: 0.006, phase: 2.1 },
  { k: 7, amp: 0.004, phase: 4.3 },
]
const STEPS = 96

function handDrawn(): string {
  const points: string[] = []
  for (let i = 0; i < STEPS; i++) {
    const angle = (i / STEPS) * Math.PI * 2
    const radius = 1 + WOBBLE.reduce((sum, w) => sum + w.amp * Math.sin(w.k * angle + w.phase), 0)
    points.push(`${(Math.cos(angle) * radius).toFixed(4)} ${(Math.sin(angle) * radius).toFixed(4)}`)
  }
  return `M${points.join('L')}Z`
}

const PATH = handDrawn()

const ring = ref<HTMLElement | null>(null)
const hover = ref(false)
const grab = ref(false)
const away = ref(true)
const target = { x: 0, y: 0 }
const at = { x: 0, y: 0 }
let over: Element | null = null
let frame = 0
let last = 0
let still = false

const radius = computed(() => {
  if (props.mode !== 'map') return RADIUS[props.mode]
  if (grab.value) return RADIUS.grab
  return hover.value ? RADIUS.hover : RADIUS.map
})

function onMove(event: PointerEvent) {
  if (event.pointerType !== 'mouse') return
  target.x = event.clientX
  target.y = event.clientY
  over = event.target as Element
  if (away.value) {
    at.x = target.x
    at.y = target.y
    away.value = false
  }
}

function onDown(event: PointerEvent) {
  // Seule la carte se saisit ; un nom de la carte, lui, se clique.
  grab.value = event.button === 0 && event.target instanceof HTMLCanvasElement && !hover.value
}

function onUp() {
  grab.value = false
}

function onLeave() {
  away.value = true
}

function tick(now: number) {
  const dt = last ? Math.min(now - last, 64) : 16
  last = now
  const k = still ? 1 : 1 - Math.exp(-dt / FOLLOW_MS)
  at.x += (target.x - at.x) * k
  at.y += (target.y - at.y) * k
  // Les noms de la carte ne sont pas des elements : le rendu dit leur survol par le curseur du canvas.
  hover.value = !!over && (!!over.closest(CLICKABLE) || getComputedStyle(over).cursor === 'pointer')
  if (ring.value) ring.value.style.transform = `translate3d(${at.x}px, ${at.y}px, 0) translate(-50%, -50%)`
  frame = requestAnimationFrame(tick)
}

onMounted(() => {
  still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  window.addEventListener('pointermove', onMove, { passive: true })
  window.addEventListener('pointerdown', onDown)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onUp)
  window.addEventListener('blur', onUp)
  document.documentElement.addEventListener('mouseleave', onLeave)
  frame = requestAnimationFrame(tick)
})

onBeforeUnmount(() => {
  cancelAnimationFrame(frame)
  window.removeEventListener('pointermove', onMove)
  window.removeEventListener('pointerdown', onDown)
  window.removeEventListener('pointerup', onUp)
  window.removeEventListener('pointercancel', onUp)
  window.removeEventListener('blur', onUp)
  document.documentElement.removeEventListener('mouseleave', onLeave)
})
</script>

<template>
  <div
    ref="ring"
    data-cursor-ring
    class="cursor"
    :class="{ 'is-away': away }"
    :style="{ '--r': `${radius}px` }"
    aria-hidden="true"
  >
    <svg viewBox="-1.15 -1.15 2.3 2.3">
      <path class="cursor__halo" :d="PATH" />
      <path class="cursor__line" :d="PATH" />
    </svg>
  </div>
</template>

<style scoped>
.cursor {
  position: fixed;
  top: 0;
  left: 0;
  z-index: 60;
  width: calc(var(--r) * 2.3);
  height: calc(var(--r) * 2.3);
  pointer-events: none;
  transition:
    width 320ms cubic-bezier(0.16, 1, 0.3, 1),
    height 320ms cubic-bezier(0.16, 1, 0.3, 1),
    opacity 200ms ease;
}

.cursor.is-away {
  opacity: 0;
}

.cursor svg {
  display: block;
  width: 100%;
  height: 100%;
  overflow: visible;
}

.cursor path {
  fill: none;
  stroke-linecap: round;
  stroke-linejoin: round;
  vector-effect: non-scaling-stroke;
}

.cursor__line {
  stroke: rgb(var(--ui-ink) / 0.85);
  stroke-width: 1.15px;
}

/* Un liseré de papier sous le trait : il reste lisible sur les hachures denses. */
.cursor__halo {
  stroke: rgb(var(--ui-paper) / 0.55);
  stroke-width: 3px;
}

/* Au doigt, pas de pointeur a entourer. */
@media (pointer: coarse) {
  .cursor {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .cursor {
    transition: none;
  }
}
</style>
