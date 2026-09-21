import { DataTexture, RGBAFormat, UnsignedByteType } from "three";
import { texture } from "three/tsl";
import type { Node } from "three/webgpu";

/**
 * Bruit peint (`assets-source/Images/Diffuse/noise.png`, 512 px, niveaux de gris, raccord continu) : une lecture de
 * texture remplace un bruit de Perlin calcule a chaque pixel, qui coutait cher plein ecran. La texture est posee au
 * montage de l'univers, avant la premiere image : un materiau compile avant garderait la texture d'attente.
 */
export const noiseMap = texture(new DataTexture(new Uint8Array([97, 97, 97, 255]), 1, 1, RGBAFormat, UnsignedByteType));

/** Moyenne et etendue haute du bruit peint : `noiseAt` le recentre dans [-1, 1] comme un Perlin. */
const MEAN = 0.38;
const SPAN = 1 - MEAN;

/** Bruit au point `p` (une repetition de la texture par unite), dans [0, 1]. */
export function noise01(p: Node): Node {
  return noiseMap.sample(p).r;
}

/** Bruit au point `p`, recentre autour de 0 et borne a [-1, 1] : de quoi remplacer `mx_noise_float`. */
export function noiseAt(p: Node): Node {
  return noise01(p).sub(MEAN).div(SPAN);
}
