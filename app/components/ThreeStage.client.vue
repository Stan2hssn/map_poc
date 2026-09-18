<script setup lang="ts">
import { isDebugRequested, isStatsRequested } from '@_core/debug/DebugFlags.ts'
import type ThreeDevice from '@_core/systems/ThreeDevice.ts'

const emit = defineEmits<{ ready: []; failed: [] }>()

const surface = useTemplateRef<HTMLCanvasElement>('surface')

/** WebGL peut manquer : contexte refuse, GPU bloque, navigateur sans support. */
const failed = ref(false)
/** Le canvas reste transparent tant qu'aucune image n'a ete rendue. */
const ready = ref(false)

let device: ThreeDevice | null = null
let observer: ResizeObserver | null = null

/**
 * Le canvas est observe, et pas seulement la fenetre. ThreeDevice ecoute deja
 * `resize` sur window, mais cet evenement ne part pas quand le canvas passe
 * d'une boite nulle a une boite reelle — le cas exact d'un composant `.client`
 * monte avant que la mise en page ne soit posee.
 *
 * Une boite degeneree est ignoree : un aspect 0/0 donne NaN, et la camera n'en
 * revient pas toute seule au retour sur l'onglet.
 */
function resize() {
  const canvas = surface.value
  if (!device || !canvas) return
  const { clientWidth, clientHeight } = canvas
  if (clientWidth <= 0 || clientHeight <= 0) return
  device.resize(clientWidth, clientHeight)
}

/**
 * Un tick d'attente avant de lire la ref : dans un composant `.client` de Nuxt,
 * le DOM n'est pas encore attache au `onMounted` du composant lui-meme, et la
 * ref y vaut null.
 */
onMounted(async () => {
  await nextTick()
  const canvas = surface.value
  if (!canvas) return

  try {
    // Import dynamique : three et tweakpane pesent lourd, et
    // rien de tout cela n'a de raison d'entrer dans le chunk d'entree.
    const { default: Device } = await import('@_core/systems/ThreeDevice.ts')
    device = await Device.create(canvas, {
      // L'antialiasing se regle sur l'EffectComposer : la derniere passe est un triangle plein ecran.
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
      // Temps GPU par image, pour le panneau : seulement quand on le demande.
      trackTimestamp: isDebugRequested() || isStatsRequested(),
    })
  } catch (error) {
    // Sans contexte, la page reste entiere : seul le canvas manque.
    failed.value = true
    emit('failed')
    console.error('[ThreeStage] initialisation impossible', error)
    return
  }

  ready.value = true
  emit('ready')
  observer = new ResizeObserver(resize)
  observer.observe(canvas)

  useThreeStage().publish(device)

  // Sonde de developpement : donne acces a la scene depuis la console du
  // navigateur. `import.meta.dev` est statique, la branche disparait du build.
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

  /* Le geste appartient a la scene. Sans cela le navigateur mobile se sert le
     premier — defilement elastique, zoom au double-tap, tire-pour-rafraichir —
     et le glissement qui pilote la scene n'arrive jamais jusqu'a nous. */
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
