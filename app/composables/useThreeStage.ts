import type ThreeDevice from '@_core/systems/ThreeDevice.ts'

/**
 * Point de rendez-vous entre la scene et ce qui veut la lire de l'exterieur —
 * une sonde, une page, un test. Le composant publie le device qu'il vient de
 * creer, sans que personne ait a l'importer.
 *
 * Une reference de module et non `useState` : un WebGLRenderer n'est pas
 * serialisable, il ne peut donc pas transiter par le payload Nuxt.
 */
let current: ThreeDevice | null = null

export function useThreeStage() {
  return {
    publish(device: ThreeDevice | null): void {
      current = device
    },
    /** Relu a chaque appel : le device meurt et renait aux changements de route. */
    read(): ThreeDevice | null {
      return current
    },
  }
}
