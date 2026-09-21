<script setup lang="ts">
/**
 * Cercle trace autour du pointeur, pour toute l'experience ; le pointeur du systeme reste visible en son
 * centre. En HTML et au-dessus de tout : dessine dans le rendu, il passerait sous le panneau et l'interface.
 *
 * A l'intro il est ouvert, davantage quand l'experience peut partir (le mot `Entrer` s'y pose, dessine par
 * `IntroNode` d'apres ce cercle). Sur la carte il se resserre, un peu plus quand on la saisit, et s'ouvre
 * legerement sur ce qui se clique — bouton de l'interface ou nom de la carte.
 *
 * Trace comme a la main, pour rester dans le dessin : un rayon qui ondule, un trait qui depasse son depart sans
 * le rejoindre, et trois etats du meme trace qui alternent a la cadence d'une animation dessinee.
 */
const props = defineProps<{ mode: 'loading' | 'ready' | 'map' }>()

/** Rayons (px) selon l'etat. */
const RADIUS = { loading: 30, ready: 44, map: 12, hover: 17, grab: 8 }
/** Temps de reponse du cercle au pointeur (ms) : il le rattrape sans y coller. */
const FOLLOW_MS = 55
const CLICKABLE = 'a, button, input, select, textarea, label, [role="button"]'
/** Etats du trace et duree de chacun (ms) : un trait anime a la main tremble, il ne tourne pas. */
const DRAWINGS = 3
const DRAWING_MS = 140

/**
 * Cercle a main levee de rayon 1 : ondulation lente du rayon, depart pris au hasard, un trait qui depasse son
 * depart d'un vingtieme de tour en s'ecartant un peu, comme une plume qui ne revient pas exactement a son point.
 */
function handDrawn(seed: number): string {
  let state = seed * 9301 + 49297
  const random = () => ((state = (state * 9301 + 49297) % 233280) / 233280)
  const start = random() * Math.PI * 2
  const waves = [1, 2, 3].map((k) => ({ k, amp: (0.035 / k) * (0.6 + random()), phase: random() * Math.PI * 2 }))
  const sweep = Math.PI * 2 * 1.06
  const steps = 72
  const points: string[] = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const angle = start + sweep * t
    const radius = 0.98 + 0.04 * t + waves.reduce((sum, w) => sum + w.amp * Math.sin(w.k * angle + w.phase), 0)
    points.push(`${(Math.cos(angle) * radius).toFixed(3)} ${(Math.sin(angle) * radius).toFixed(3)}`)
  }
  return `M${points.join('L')}`
}

const PATHS = Array.from({ length: DRAWINGS }, (_, i) => handDrawn(i + 1))

const ring = ref<HTMLElement | null>(null)
const drawing = ref(0)
const hover = ref(false)
const grab = ref(false)
const away = ref(true)
const target = { x: 0, y: 0 }
const at = { x: 0, y: 0 }
let over: Element | null = null
let frame = 0
let last = 0
let still = false
let drawnAt = 0

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
  if (!still && now - drawnAt > DRAWING_MS) {
    drawnAt = now
    drawing.value = (drawing.value + 1) % DRAWINGS
  }
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
      <path class="cursor__halo" :d="PATHS[drawing]" />
      <path class="cursor__line" :d="PATHS[drawing]" />
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
