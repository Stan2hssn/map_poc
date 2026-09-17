import { Box3, BufferAttribute, BufferGeometry, Sphere, Vector3 } from "three";

// Parois du carre unite (x est, z sud) : depart, sens de parcours, normale sortante.
const SIDES = [
  { from: [0, 0], dir: [1, 0], normal: [0, -1] },
  { from: [1, 1], dir: [-1, 0], normal: [0, 1] },
  { from: [0, 1], dir: [0, -1], normal: [-1, 0] },
  { from: [1, 0], dir: [0, 1], normal: [1, 0] },
] as const;

/**
 * Bloc unite : dessus en grille (y = 0), parois et fond (y = -1 pour le bas).
 * Le shader place le dessus et le haut des parois a l'altitude, le bas a la profondeur du socle.
 */
export function createBlockGeometry(segments: number): BufferGeometry {
  const n = segments + 1;
  const position = new Float32Array((n * n + 8 * n + 4) * 3);
  const normal = new Float32Array(position.length);
  const index = new Uint32Array(6 * segments * segments + 24 * segments + 6);
  let v = 0;
  let i = 0;

  const put = (x: number, y: number, z: number, nx: number, ny: number, nz: number) => {
    const o = v * 3;
    position[o] = x;
    position[o + 1] = y;
    position[o + 2] = z;
    normal[o] = nx;
    normal[o + 1] = ny;
    normal[o + 2] = nz;
    return v++;
  };
  // Triangles (a, c, b) et (b, c, d).
  const quad = (a: number, b: number, c: number, d: number) => {
    index[i++] = a;
    index[i++] = c;
    index[i++] = b;
    index[i++] = b;
    index[i++] = c;
    index[i++] = d;
  };

  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) put(col / segments, 0, row / segments, 0, 1, 0);
  }
  for (let row = 0; row < segments; row++) {
    for (let col = 0; col < segments; col++) {
      const a = row * n + col;
      quad(a, a + 1, a + n, a + n + 1);
    }
  }

  for (const { from, dir, normal: [nx, nz] } of SIDES) {
    const start = v;
    for (let k = 0; k < n; k++) {
      const x = from[0] + (dir[0] * k) / segments;
      const z = from[1] + (dir[1] * k) / segments;
      put(x, 0, z, nx, 0, nz);
      put(x, -1, z, nx, 0, nz);
    }
    for (let k = 0; k < segments; k++) {
      const top = start + k * 2;
      quad(top, top + 1, top + 2, top + 3);
    }
  }

  const a = put(0, -1, 0, 0, -1, 0);
  const b = put(1, -1, 0, 0, -1, 0);
  const c = put(0, -1, 1, 0, -1, 0);
  const d = put(1, -1, 1, 0, -1, 0);
  quad(a, c, b, d);

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(position, 3));
  geometry.setAttribute("normal", new BufferAttribute(normal, 3));
  geometry.setIndex(new BufferAttribute(index, 1));
  // Altitudes posees par le shader : bornes elargies pour le culling (km).
  geometry.boundingBox = new Box3(new Vector3(0, -20, 0), new Vector3(1, 20, 1));
  geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new Sphere());
  return geometry;
}
