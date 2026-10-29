import type { DeviceConfig } from "@_core/systems/DeviceConfig.type.ts";
import { DEBUG_PERSISTENCE } from "@graphics/debug/debug.values.ts";

export const DEVICE_CONFIG: DeviceConfig = {
  // Doit suivre `graphics/postprocessing/index.ts`.
  renderer: { backend: "webgpu" },

  // Les reglages du panneau sont la configuration de la scene : relus panneau ouvert ou non.
  debugPersistence: DEBUG_PERSISTENCE,
};
