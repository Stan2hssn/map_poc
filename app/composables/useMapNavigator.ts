import { isMapNavigator } from '@graphics/universes/MapNavigator.interface.ts'

/** Relu a chaque appel, comme le device : l'univers actif change avec lui. */
export function useMapNavigator() {
  const universes = useThreeStage().read()?.runtime.output.getActiveUniverses() ?? []
  return universes.find(isMapNavigator) ?? null
}
