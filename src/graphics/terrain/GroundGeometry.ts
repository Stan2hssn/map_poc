import { Box3, BufferAttribute, BufferGeometry, Sphere, Vector3 } from "three";

/** Pente de la grille au centre, relative a une grille reguliere de meme etendue. */
const CENTER_DENSITY = 1 / 3;

/** Resserre la grille au centre : t dans [-1, 1], pente `CENTER_DENSITY` en 0, bords inchanges. */
export function warp(t: number): number {
  return t * (CENTER_DENSITY + (1 - CENTER_DENSITY) * t * t);
}

/**
 * Sol plein ecran : grille (y = 0) en uv du bloc, de `0.5 - span / 2` a `0.5 + span / 2`.
 * Resserree au centre ou la vue s'attarde, relachee vers les bords que le brouillard efface.
 */
export function createGroundGeometry(segments: number, span: number): BufferGeometry {
  const n = segments + 1;
  const position = new Float32Array(n * n * 3);
  const normal = new Float32Array(n * n * 3);
  const index = new Uint32Array(6 * segments * segments);
  const coord = Float32Array.from({ length: n }, (_, k) => 0.5 + (warp((2 * k) / segments - 1) * span) / 2);

  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const o = (row * n + col) * 3;
      position[o] = coord[col]!;
      position[o + 2] = coord[row]!;
      normal[o + 1] = 1;
    }
  }
  let i = 0;
  for (let row = 0; row < segments; row++) {
    for (let col = 0; col < segments; col++) {
      const a = row * n + col;
      index.set([a, a + n, a + 1, a + 1, a + n, a + n + 1], i);
      i += 6;
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(position, 3));
  geometry.setAttribute("normal", new BufferAttribute(normal, 3));
  geometry.setIndex(new BufferAttribute(index, 1));
  // Altitudes posees par le shader : bornes elargies pour le culling.
  const half = span / 2;
  geometry.boundingBox = new Box3(new Vector3(0.5 - half, -1, 0.5 - half), new Vector3(0.5 + half, 1, 0.5 + half));
  geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new Sphere());
  return geometry;
}
