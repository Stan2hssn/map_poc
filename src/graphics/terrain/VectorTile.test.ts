import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeVectorTile, GEOMETRY, partsOf } from "./VectorTile.ts";

// Encodeur protobuf minimal, juste pour fabriquer des tuiles de test.
const varint = (n: number): number[] => {
  const out: number[] = [];
  do {
    out.push((n & 0x7f) | (n >= 0x80 ? 0x80 : 0));
    n = Math.floor(n / 128);
  } while (n > 0);
  return out;
};
const zz = (n: number) => (n << 1) ^ (n >> 31);
const key = (field: number, wire: number) => varint((field << 3) | wire);
const bytes = (field: number, payload: number[]) => [...key(field, 2), ...varint(payload.length), ...payload];
const text = (field: number, s: string) => bytes(field, [...new TextEncoder().encode(s)]);
const packed = (field: number, values: number[]) => bytes(field, values.flatMap(varint));
const double = (v: number) => [...key(3, 1), ...new Uint8Array(new Float64Array([v]).buffer)];

function tile(): ArrayBuffer {
  const square = [...packed(2, [0, 0]), ...key(3, 0), GEOMETRY.polygon, ...packed(4, [9, zz(10), zz(20), 18, zz(5), zz(0), zz(0), zz(5), 15])];
  const line = [...key(3, 0), GEOMETRY.line, ...packed(4, [9, zz(0), zz(0), 10, zz(3), zz(4)])];
  const layer = [...text(1, "bati"), ...bytes(2, square), ...bytes(2, line), ...text(3, "hauteur"), ...bytes(4, double(12.5)), ...key(5, 0), ...varint(4096)];
  return new Uint8Array(bytes(3, layer)).buffer;
}

test("couches, attributs et geometries en coordonnees absolues", () => {
  const layers = decodeVectorTile(tile());
  const bati = layers.get("bati")!;
  assert.equal(bati.extent, 4096);
  assert.equal(bati.features.length, 2);
  const [square, line] = bati.features;
  assert.equal(square!.type, GEOMETRY.polygon);
  assert.deepEqual(square!.properties, { hauteur: 12.5 });
  assert.deepEqual(partsOf(bati, square!), [[10, 20, 15, 20, 15, 25, 10, 20]]);
  assert.equal(line!.type, GEOMETRY.line);
  assert.deepEqual(partsOf(bati, line!), [[0, 0, 3, 4]]);
});

test("tuile vide : aucune couche", () => {
  assert.equal(decodeVectorTile(new ArrayBuffer(0)).size, 0);
});

test("couches et attributs choisis : le reste n'est pas decode", () => {
  const layers = decodeVectorTile(tile(), { bati: [] });
  assert.deepEqual(layers.get("bati")!.features[0]!.properties, {});
  assert.equal(decodeVectorTile(tile(), { route: ["symbo"] }).size, 0);
  assert.deepEqual(decodeVectorTile(tile(), { bati: ["hauteur"] }).get("bati")!.features[0]!.properties, { hauteur: 12.5 });
});
