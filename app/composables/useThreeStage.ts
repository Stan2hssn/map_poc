import type ThreeDevice from '@_core/systems/ThreeDevice.ts'

// Variable de module et non `useState` : un renderer n'est pas serialisable dans le payload Nuxt.
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
