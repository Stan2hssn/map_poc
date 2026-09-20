/**
 * Champ de distance signe d'une image binaire, par la transformee de distance exacte de Felzenszwalb et
 * Huttenlocher (deux passes 1D, en O(n)) : chaque pixel recoit sa distance au bord le plus proche, positive
 * dedans, negative dehors. C'est ce que lit le shader du texte pour garder un bord net a toute echelle.
 */

const FAR = 1e20;

/** Transformee 1D : distance au carre de chaque case a la parabole la plus basse (voir l'article). */
function transform(source: Float32Array, size: number, into: Float32Array, hull: Int32Array, edges: Float32Array): void {
  let k = 0;
  hull[0] = 0;
  edges[0] = -FAR;
  edges[1] = FAR;
  for (let q = 1; q < size; q++) {
    let s = 0;
    // Remonte tant que la nouvelle parabole passe sous la precedente.
    for (;;) {
      const p = hull[k]!;
      s = (source[q]! + q * q - (source[p]! + p * p)) / (2 * q - 2 * p);
      if (s > edges[k]!) break;
      k--;
    }
    k++;
    hull[k] = q;
    edges[k] = s;
    edges[k + 1] = FAR;
  }
  k = 0;
  for (let q = 0; q < size; q++) {
    while (edges[k + 1]! < q) k++;
    const p = hull[k]!;
    into[q] = (q - p) * (q - p) + source[p]!;
  }
}

/** Distances (en pixels) de chaque case a la plus proche case allumee, par la transformee 2D. */
function distances(mask: Uint8Array, width: number, height: number, lit: boolean): Float32Array {
  const size = Math.max(width, height);
  const squared = new Float32Array(width * height);
  const column = new Float32Array(size);
  const result = new Float32Array(size);
  const hull = new Int32Array(size);
  const edges = new Float32Array(size + 1);
  for (let i = 0; i < squared.length; i++) squared[i] = (mask[i]! > 127) === lit ? 0 : FAR;
  for (let y = 0; y < height; y++) {
    const row = squared.subarray(y * width, y * width + width);
    transform(row, width, result, hull, edges);
    row.set(result.subarray(0, width));
  }
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) column[y] = squared[y * width + x]!;
    transform(column, height, result, hull, edges);
    for (let y = 0; y < height; y++) squared[y * width + x] = result[y]!;
  }
  for (let i = 0; i < squared.length; i++) squared[i] = Math.sqrt(squared[i]!);
  return squared;
}

/**
 * Champ de distance signe de `mask` (0 dehors, 255 dedans), encode sur un octet : 128 sur le bord, et
 * `spread` pixels de part et d'autre pour arriver a 0 ou 255. Le shader y cherche donc toujours 0,5.
 */
export function signedDistanceField(mask: Uint8Array, width: number, height: number, spread: number): Uint8Array {
  const inside = distances(mask, width, height, true);
  const outside = distances(mask, width, height, false);
  const field = new Uint8Array(width * height);
  for (let i = 0; i < field.length; i++) {
    // Dedans, la distance au dehors est positive ; dehors, l'inverse. La difference donne le signe d'un coup.
    const signed = outside[i]! - inside[i]!;
    field[i] = Math.max(0, Math.min(255, Math.round(128 + (signed / spread) * 127)));
  }
  return field;
}
