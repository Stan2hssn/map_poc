/**
 * Lecture minimale des tuiles vectorielles (Mapbox Vector Tile 2.1) : couches, type, attributs,
 * geometrie en coordonnees de tuile (0 a `extent`). Pas de dependance : seul le protobuf utile est lu.
 */

export const GEOMETRY = { point: 1, line: 2, polygon: 3 } as const;

export interface VectorFeature {
  type: number;
  properties: Record<string, string | number | boolean>;
  /** Parties (anneaux ou lignes), chacune une suite x0, y0, x1, y1... */
  geometry: number[][];
}

export interface VectorLayer {
  extent: number;
  features: VectorFeature[];
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

/** Commandes MoveTo / LineTo / ClosePath vers des parties en coordonnees absolues. */
function geometry(commands: number[]): number[][] {
  const parts: number[][] = [];
  let part: number[] = [];
  let x = 0;
  let y = 0;
  for (let i = 0; i < commands.length; ) {
    const command = commands[i]! & 7;
    const count = commands[i++]! >> 3;
    if (command === 7) {
      if (part.length) part.push(part[0]!, part[1]!);
      continue;
    }
    for (let k = 0; k < count; k++) {
      x += zigzag(commands[i++]!);
      y += zigzag(commands[i++]!);
      if (command === 1) {
        if (part.length) parts.push(part);
        part = [];
      }
      part.push(x, y);
    }
  }
  if (part.length) parts.push(part);
  return parts;
}

function layer(bytes: Uint8Array): [string, VectorLayer] {
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
  const features = raw.map(({ type, tags, commands }) => {
    const properties: VectorFeature["properties"] = {};
    for (let i = 0; i < tags.length; i += 2) properties[keys[tags[i]!]!] = values[tags[i + 1]!]!;
    return { type, properties, geometry: geometry(commands) };
  });
  return [name, { extent, features }];
}

export function decodeVectorTile(buffer: ArrayBuffer): Map<string, VectorLayer> {
  const r = new Reader(new Uint8Array(buffer));
  const layers = new Map<string, VectorLayer>();
  r.fields((field, wire) => {
    if (field !== 3 || wire !== 2) return false;
    const [name, data] = layer(r.bytes());
    layers.set(name, data);
    return true;
  });
  return layers;
}
