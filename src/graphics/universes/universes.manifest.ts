import type { UniverseBase } from "@_core/universes/Universe.base.ts";
import type { IThreeDeviceSlice } from "../../_core/systems/ThreeDevice.ts";
import { MainUniverse } from "./impl/Main.universe.ts";
import type { UniverseId } from "./Universe.id.ts";
import { UNIVERSE_ID } from "./Universe.id.ts";

export const UNIVERSE_MANIFEST: {
  id: UniverseId;
  ctor: new (device: IThreeDeviceSlice) => UniverseBase<UniverseId>;
  isDefault: boolean;
}[] = [{ id: UNIVERSE_ID.MAIN, ctor: MainUniverse, isDefault: true }];
