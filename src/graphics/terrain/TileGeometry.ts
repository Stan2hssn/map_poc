import { Box3, BufferGeometry, Float32BufferAttribute, Sphere, Vector3 } from "three";

/**
 * Grille unitaire (x vers l'est, z vers le sud, uv = (x, z)) bordee d'une jupe :
 * copie des bords marquee `skirt`, que le shader descend pour cacher les fissures entre niveaux.
 */
export function createTileGeometry(segments: number): BufferGeometry {
  const n = segments + 1;
  const at = (col: number, row: number) => row * n + col;
  const positions: number[] = [];
  const uvs: number[] = [];
  const skirt: number[] = [];
  const indices: number[] = [];

  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      positions.push(col / segments, 0, row / segments);
      uvs.push(col / segments, row / segments);
      skirt.push(0);
    }
  }
  for (let row = 0; row < segments; row++) {
    for (let col = 0; col < segments; col++) {
      const a = at(col, row);
      const b = at(col + 1, row);
      const c = at(col, row + 1);
      const d = at(col + 1, row + 1);
      indices.push(a, c, b, b, c, d);
    }
  }

  const border: number[] = [];
  for (let col = 0; col < segments; col++) border.push(at(col, 0));
  for (let row = 0; row < segments; row++) border.push(at(segments, row));
  for (let col = segments; col > 0; col--) border.push(at(col, segments));
  for (let row = segments; row > 0; row--) border.push(at(0, row));

  border.forEach((vertex, i) => {
    positions.push(positions[vertex * 3], 0, positions[vertex * 3 + 2]);
    uvs.push(uvs[vertex * 2], uvs[vertex * 2 + 1]);
    skirt.push(1);
    const next = border[(i + 1) % border.length];
    const low = n * n + i;
    const lowNext = n * n + ((i + 1) % border.length);
    indices.push(vertex, next, low, next, lowNext, low);
  });

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("skirt", new Float32BufferAttribute(skirt, 1));
  geometry.setIndex(indices);
  // Deplacement fait dans le shader : bornes elargies (-2 a 5 km) pour le culling.
  geometry.boundingBox = new Box3(new Vector3(0, -2, 0), new Vector3(1, 5, 1));
  geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new Sphere());
  return geometry;
}
