/**
 * Lecture minimale des tuiles vectorielles (Mapbox Vector Tile 2.1) : couches, type, attributs,
 * geometrie en coordonnees de tuile (0 a `extent`). Pas de dependance : seul le protobuf utile est lu.
 */

export const GEOMETRY = { point: 1, line: 2, polygon: 3 } as const;

export interface VectorFeature {
  type: number;
  properties: Record<string, string | number | boolean>;
  /** Parties (anneaux ou lignes) dans `VectorLayer.coords` : la premiere commence a `start`, chacune finit a `ends[i]` (exclu). */
  start: number;
  ends: number[];
}

export interface VectorLayer {
  extent: number;
  features: VectorFeature[];
  /** Coordonnees de toutes les entites, x0, y0, x1, y1... en entiers de tuile : un tableau par couche plutot qu'un par anneau. */
  coords: Int16Array;
}

const NO_PROPERTIES: VectorFeature["properties"] = Object.freeze({});

/** Parties d'une entite, en tableaux ordinaires (decoupe, triangulation, tests). */
export function partsOf(layer: VectorLayer, feature: VectorFeature): number[][] {
  let start = feature.start;
  return feature.ends.map((end) => {
    const part = Array.from(layer.coords.subarray(start, end));
    start = end;
    return part;
  });
}

/** Surface d'une entite : ses anneaux (coordonnees de tuile) et leur boite. */
export interface Surface {
  rings: number[][];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function surfaceOf(layer: VectorLayer, feature: VectorFeature): Surface {
  const rings = partsOf(layer, feature);
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i += 2) {
      minX = Math.min(minX, ring[i]!);
      maxX = Math.max(maxX, ring[i]!);
      minY = Math.min(minY, ring[i + 1]!);
      maxY = Math.max(maxY, ring[i + 1]!);
    }
  }
  return { rings, minX, minY, maxX, maxY };
}

/** Point dans la surface (pair-impair sur tous ses anneaux : les cours sont dehors). */
export function surfaceContains({ rings, minX, minY, maxX, maxY }: Surface, x: number, y: number): boolean {
  if (x < minX || x > maxX || y < minY || y > maxY) return false;
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
      const [xi, yi, xj, yj] = [ring[i]!, ring[i + 1]!, ring[j]!, ring[j + 1]!];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/** Couche construite a partir d'entites ecrites a la main (tests). */
export function vectorLayer(
  extent: number,
  features: { type: number; properties?: VectorFeature["properties"]; geometry: number[][] }[]
): VectorLayer {
  const coords: number[] = [];
  const out = features.map(({ type, properties = NO_PROPERTIES, geometry }) => {
    const start = coords.length;
    const ends = geometry.map((part) => (coords.push(...part), coords.length));
    return { type, properties, start, ends };
  });
  return { extent, features: out, coords: Int16Array.from(coords) };
}

class Reader {
  pos = 0;
  private readonly buf: Uint8Array;

  constructor(buf: Uint8Array) {
    this.buf = buf;
  }

  get done(): boolean {
    return this.pos >= this.buf.length;
  }

  varint(): number {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = this.buf[this.pos++]!;
      result += (byte & 0x7f) * 2 ** shift;
      shift += 7;
    } while (byte & 0x80);
    return result;
  }

  bytes(): Uint8Array {
    const length = this.varint();
    const start = this.pos;
    this.pos += length;
    return this.buf.subarray(start, this.pos);
  }

  skip(wire: number): void {
    if (wire === 0) this.varint();
    else if (wire === 1) this.pos += 8;
    else if (wire === 2) this.pos += this.varint();
    else if (wire === 5) this.pos += 4;
  }

  /** Parcourt les champs : `read(champ, type)` lit ou laisse passer. */
  fields(read: (field: number, wire: number) => boolean): void {
    while (!this.done) {
      const key = this.varint();
      if (!read(key >> 3, key & 7)) this.skip(key & 7);
    }
  }
}

const utf8 = new TextDecoder();
const zigzag = (n: number) => (n >>> 1) ^ -(n & 1);

function packed(bytes: Uint8Array): number[] {
  const r = new Reader(bytes);
  const out: number[] = [];
  while (!r.done) out.push(r.varint());
  return out;
}

function value(bytes: Uint8Array): string | number | boolean {
  const r = new Reader(bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let result: string | number | boolean = "";
  r.fields((field, wire) => {
    if (field === 1 && wire === 2) result = utf8.decode(r.bytes());
    else if (field === 2 && wire === 5) (result = view.getFloat32(r.pos, true)), (r.pos += 4);
    else if (field === 3 && wire === 1) (result = view.getFloat64(r.pos, true)), (r.pos += 8);
    else if ((field === 4 || field === 5) && wire === 0) result = r.varint();
    else if (field === 6 && wire === 0) result = zigzag(r.varint());
    else if (field === 7 && wire === 0) result = r.varint() !== 0;
    else return false;
    return true;
  });
  return result;
}

/** Coordonnees d'une couche, accumulees sans un tableau par anneau. */
class Coords {
  data = new Int16Array(4096);
  length = 0;

  push(x: number, y: number): void {
    if (this.length + 2 > this.data.length) {
      const grown = new Int16Array(this.data.length * 2);
      grown.set(this.data);
      this.data = grown;
    }
    this.data[this.length++] = x;
    this.data[this.length++] = y;
  }
}

/** Commandes MoveTo / LineTo / ClosePath vers des parties en coordonnees absolues ; rend la fin de chaque partie. */
function geometry(commands: number[], coords: Coords): number[] {
  const ends: number[] = [];
  let first = coords.length;
  let x = 0;
  let y = 0;
  for (let i = 0; i < commands.length; ) {
    const command = commands[i]! & 7;
    const count = commands[i++]! >> 3;
    if (command === 7) {
      if (coords.length > first) coords.push(coords.data[first]!, coords.data[first + 1]!);
      continue;
    }
    for (let k = 0; k < count; k++) {
      x += zigzag(commands[i++]!);
      y += zigzag(commands[i++]!);
      if (command === 1) {
        if (coords.length > first) ends.push(coords.length);
        first = coords.length;
      }
      coords.push(x, y);
    }
  }
  if (coords.length > first) ends.push(coords.length);
  return ends;
}

/** Nom d'une couche, lu sans decoder le reste. */
function layerName(bytes: Uint8Array): string {
  const r = new Reader(bytes);
  let name = "";
  r.fields((field, wire) => {
    if (field !== 1 || wire !== 2 || name) return false;
    name = utf8.decode(r.bytes());
    return true;
  });
  return name;
}

function layer(bytes: Uint8Array, kept?: readonly string[]): [string, VectorLayer] {
  const r = new Reader(bytes);
  let name = "";
  let extent = 4096;
  const keys: string[] = [];
  const values: (string | number | boolean)[] = [];
  const raw: { type: number; tags: number[]; commands: number[] }[] = [];
  r.fields((field, wire) => {
    if (wire !== 2 && field !== 5) return false;
    if (field === 1) name = utf8.decode(r.bytes());
    else if (field === 3) keys.push(utf8.decode(r.bytes()));
    else if (field === 4) values.push(value(r.bytes()));
    else if (field === 5) extent = r.varint();
    else if (field === 2) {
      const f = new Reader(r.bytes());
      const feature = { type: 0, tags: [] as number[], commands: [] as number[] };
      f.fields((ff, fw) => {
        if (ff === 2 && fw === 2) feature.tags = packed(f.bytes());
        else if (ff === 3 && fw === 0) feature.type = f.varint();
        else if (ff === 4 && fw === 2) feature.commands = packed(f.bytes());
        else return false;
        return true;
      });
      raw.push(feature);
    } else return false;
    return true;
  });
  const coords = new Coords();
  const features = raw.map(({ type, tags, commands }) => {
    let properties = NO_PROPERTIES;
    for (let i = 0; i < tags.length; i += 2) {
      const key = keys[tags[i]!]!;
      if (kept && !kept.includes(key)) continue;
      if (properties === NO_PROPERTIES) properties = {};
      properties[key] = values[tags[i + 1]!]!;
    }
    const start = coords.length;
    return { type, properties, start, ends: geometry(commands, coords) };
  });
  return [name, { extent, features, coords: coords.data.slice(0, coords.length) }];
}

/**
 * `wanted` : couches a garder et, pour chacune, les attributs utiles. Le reste n'est pas decode :
 * une tuile decodee pese sinon une quinzaine de fois son fichier.
 */
export function decodeVectorTile(buffer: ArrayBuffer, wanted?: Readonly<Record<string, readonly string[]>>): Map<string, VectorLayer> {
  const r = new Reader(new Uint8Array(buffer));
  const layers = new Map<string, VectorLayer>();
  r.fields((field, wire) => {
    if (field !== 3 || wire !== 2) return false;
    const bytes = r.bytes();
    const kept = wanted?.[layerName(bytes)];
    if (wanted && !kept) return true;
    const [name, data] = layer(bytes, kept);
    layers.set(name, data);
    return true;
  });
  return layers;
}
