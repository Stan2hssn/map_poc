import { DataUtils } from "three";

/** NaN en demi-flottant : texel sans donnee. */
export const HALF_NAN = 0x7e00;

const TO_FLOAT = new Float32Array(65536);
for (let i = 0; i < TO_FLOAT.length; i++) TO_FLOAT[i] = DataUtils.fromHalfFloat(i);

export const halfToFloat = (half: number): number => TO_FLOAT[half];

export function encodeHalf(data: Float32Array): { data: Uint16Array; holes: boolean } {
  const out = new Uint16Array(data.length);
  let holes = false;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (Number.isNaN(v)) {
      out[i] = HALF_NAN;
      holes = true;
    } else {
      out[i] = DataUtils.toHalfFloat(v);
    }
  }
  return { data: out, holes };
}
