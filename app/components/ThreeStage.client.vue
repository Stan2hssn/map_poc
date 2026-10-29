<script setup lang="ts">
import { isDebugRequested, isStatsRequested } from '@_core/debug/DebugFlags.ts'
import type ThreeDevice from '@_core/systems/ThreeDevice.ts'

const emit = defineEmits<{ ready: [] }>()

const surface = useTemplateRef<HTMLCanvasElement>('surface')

const failed = ref(false)
const ready = ref(false)

let device: ThreeDevice | null = null
let observer: ResizeObserver | null = null

/**
 * `resize` sur window ne part pas quand le canvas passe d'une boite nulle a une boite reelle ; une boite
 * nulle est ignoree, son aspect NaN resterait dans la camera.
 */
function resize() {
  const canvas = surface.value
  if (!device || !canvas) return
  const { clientWidth, clientHeight } = canvas
  if (clientWidth <= 0 || clientHeight <= 0) return
  device.resize(clientWidth, clientHeight)
}

// Dans un composant `.client`, la ref vaut encore null au `onMounted`.
onMounted(async () => {
  await nextTick()
  const canvas = surface.value
  if (!canvas) return

  try {
    // Import dynamique : three et tweakpane restent hors du chunk d'entree.
    const { default: Device } = await import('@_core/systems/ThreeDevice.ts')
    device = await Device.create(canvas, {
      // L'antialiasing se regle sur l'EffectComposer : la derniere passe est un triangle plein ecran.
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
      trackTimestamp: isDebugRequested() || isStatsRequested(),
    })
  } catch (error) {
    failed.value = true
    console.error('[ThreeStage] initialisation impossible', error)
    return
  }

  // Publie avant d'annoncer : qui reagit a `ready` doit deja pouvoir lire la scene (l'intro y pose la carte).
  useThreeStage().publish(device)
  ready.value = true
  emit('ready')
  observer = new ResizeObserver(resize)
  observer.observe(canvas)

  if (import.meta.dev) {
    ;(window as unknown as { __stage?: unknown }).__stage = device
  }
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
  useThreeStage().publish(null)
  device?.dispose()
  device = null

  if (import.meta.dev) {
    ;(window as unknown as { __stage?: unknown }).__stage = undefined
  }
})
</script>

<template>
  <div class="stage">
    <canvas
      ref="surface"
      class="stage-canvas"
      :class="{ 'is-ready': ready }"
      aria-hidden="true"
    />

    <p v-if="failed" class="stage-fallback" role="status">
      Le rendu 3D n'a pas pu demarrer sur cet appareil.
    </p>
  </div>
</template>

<style scoped>
.stage {
  position: fixed;
  inset: 0;
}

.stage-canvas {
  display: block;
  width: 100%;
  height: 100%;
  opacity: 0;
  transition: opacity 220ms ease;

  /* Sans cela le navigateur mobile capte le glissement (defilement, zoom, rafraichir). */
  touch-action: none;
  -webkit-tap-highlight-color: transparent;
}

@media (prefers-reduced-motion: reduce) {
  .stage-canvas { transition: none; }
}

.stage-canvas.is-ready {
  opacity: 1;
}

.stage-fallback {
  position: absolute;
  inset: auto 0 1rem;
  margin: 0;
  text-align: center;
  font-size: 0.875rem;
  color: rgba(255, 255, 255, 0.7);
}
</style>
