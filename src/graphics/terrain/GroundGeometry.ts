import { BufferAttribute, BufferGeometry } from "three";

/** Marges de la grille au-dela de l'ecran : le relief souleve le bas, la parallaxe decale les cotes. */
export const SCREEN_MARGIN = { side: 0.04, bottom: 0.3, top: 0.02 };

/**
 * Grille de l'ecran : x, z sont des coordonnees d'ecran (0 a 1, bas-gauche a haut-droite), marges comprises.
 * Le shader projette chaque sommet sur le sol depuis la camera : toutes les subdivisions servent l'image,
 * et c'est le terrain qui defile et zoome dessous.
 */
export function createGroundGeometry(segments: number): BufferGeometry {
  const n = segments + 1;
  const position = new Float32Array(n * n * 3);
  const normal = new Float32Array(n * n * 3);
  const index = new Uint32Array(6 * segments * segments);
  const { side, bottom, top } = SCREEN_MARGIN;

  for (let row = 0; row < n; row++) {
    const t = -bottom + (row / segments) * (1 + bottom + top);
    for (let col = 0; col < n; col++) {
      const o = (row * n + col) * 3;
      position[o] = -side + (col / segments) * (1 + 2 * side);
      position[o + 2] = t;
      normal[o + 1] = 1;
    }
  }
  // Sens direct a l'ecran, donc face a la camera une fois projete.
  let i = 0;
  for (let row = 0; row < segments; row++) {
    for (let col = 0; col < segments; col++) {
      const a = row * n + col;
      index.set([a, a + 1, a + n, a + 1, a + n + 1, a + n], i);
      i += 6;
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(position, 3));
  geometry.setAttribute("normal", new BufferAttribute(normal, 3));
  geometry.setIndex(new BufferAttribute(index, 1));
  return geometry;
}
