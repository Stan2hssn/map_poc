import type { DeviceConfig } from "@_core/systems/DeviceConfig.type.ts";
import { DEBUG_PERSISTENCE } from "@graphics/debug/debug.values.ts";

/**
 * Ce que map ajoute au device sans toucher au `_core`.
 *
 * Voir `src/_core/systems/DeviceConfig.type.ts`.
 */
export const DEVICE_CONFIG: DeviceConfig = {
  // Les reglages du panneau sont la CONFIGURATION de la scene : relus au
  // demarrage, panneau ouvert ou non.
  debugPersistence: DEBUG_PERSISTENCE,
};
