import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clampCenter,
  containsBounds,
  containsPoint,
  expandBounds,
  GeoProjection,
  intersectsBounds,
  tileBounds,
  tilesCovering,
  WORLD_HEIGHT_KM,
  WORLD_WIDTH_KM,
} from "./GeoProjection.ts";

const GARD = { west: 3.2624, south: 43.4603, east: 4.8456, north: 44.4597 };
const close = (a: number, b: number, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test("un degre de latitude vaut 111,195 km vers le nord (z negatif)", () => {
  const p = new GeoProjection(4, 44);
  close(p.x(4), 0);
  close(p.z(45), -111.195);
});

test("un degre de longitude est reduit par cos(lat0)", () => {
  const p = new GeoProjection(4, 44);
  close(p.x(5), 111.195 * Math.cos((44 * Math.PI) / 180));
});

test("aller-retour lon/lat", () => {
  const p = new GeoProjection(4.05, 43.96);
  close(p.lon(p.x(3.7)), 3.7, 1e-9);
  close(p.lat(p.z(44.2)), 44.2, 1e-9);
});

test("rect : nord en haut (minZ)", () => {
  const r = new GeoProjection(4, 44).rect({ west: 3, south: 43, east: 5, north: 45 });
  assert.ok(r.minX < 0 && r.maxX > 0 && r.minZ < 0 && r.maxZ > 0);
});

test("carre centre sur l'origine de la projection", () => {
  const p = new GeoProjection(4.054, 43.96);
  const r = p.rect(p.bounds(100));
  close(r.minX, -50);
  close(r.maxX, 50);
  close(r.minZ, -50);
  close(r.maxZ, 50);
});

test("elargir, contenir", () => {
  const b = { west: 2, east: 4, south: 40, north: 42 };
  assert.deepEqual(expandBounds(b, 0.5), { west: 1, east: 5, south: 39, north: 43 });
  assert.equal(containsBounds(expandBounds(b, 0.1), b), true);
  assert.equal(containsBounds(b, expandBounds(b, 0.1)), false);
  assert.equal(containsPoint(b, 3, 41), true);
  assert.equal(containsPoint(b, 5, 41), false);
  assert.equal(intersectsBounds(b, { west: 3.5, east: 9, south: 41.5, north: 50 }), true);
  assert.equal(intersectsBounds(b, { west: 4, east: 9, south: 41, north: 42 }), false);
});

test("emprise d'une tuile WGS84G", () => {
  const b = tileBounds(9, 522, 130);
  close(b.west, 3.515625, 1e-9);
  close(b.north, 44.296875, 1e-9);
  close(b.east - b.west, 0.3515625, 1e-9);
  close(b.north - b.south, 0.3515625, 1e-9);
});

test("le Gard tient dans 20 tuiles de niveau 9", () => {
  const tiles = tilesCovering(9, GARD);
  assert.equal(tiles.length, 20);
  assert.deepEqual(tiles[0], { x: 521, y: 129 });
});

test("le monde entier : centre ramene a (0, 0), emprise bornee", () => {
  const limits = { west: -179, east: 179, south: -56, north: 60 };
  const center = clampCenter(2.35, 48.86, WORLD_WIDTH_KM, WORLD_HEIGHT_KM, limits);
  assert.deepEqual(center, { lon: 0, lat: 0 });
  const b = new GeoProjection(center.lon, center.lat).bounds(WORLD_WIDTH_KM, WORLD_HEIGHT_KM);
  assert.deepEqual(b, { west: -180, east: 180, north: 90, south: -90 });
  assert.equal(tilesCovering(1, expandBounds(b, 0.5)).length, 8);
});

test("une petite vue garde son centre, une grande est ramenee vers l'equateur", () => {
  const limits = { west: -179, east: 179, south: -56, north: 60 };
  assert.deepEqual(clampCenter(2.35, 48.86, 40, 40, limits), { lon: 2.35, lat: 48.86 });
  assert.deepEqual(clampCenter(2.35, 70, 40, 40, limits), { lon: 2.35, lat: 60 });
  close(clampCenter(2.35, 48.86, 10000, 10000, limits).lat, 90 - 5000 / 111.195);
});
