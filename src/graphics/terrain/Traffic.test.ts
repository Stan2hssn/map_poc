import assert from "node:assert/strict";
import { test } from "node:test";
import { boatLanes, LANE_STRIDE, roadLanes, Traffic } from "./Traffic.ts";
import { GEOMETRY, vectorLayer } from "./VectorTile.ts";

const E = 4096;
const TILE = { x: 16597, y: 11274 };
const roads = (...features: { geometry: number[][]; properties: Record<string, string> }[]) =>
  new Map([["routier_route", vectorLayer(E, features.map((f) => ({ type: GEOMETRY.line, ...f })))]]);

test("voies : coupees au bord de la tuile, sans les voies restreintes", () => {
  const lanes = roadLanes(
    roads(
      { geometry: [[-400, 1000, 2048, 1000, 2048, 5000]], properties: { symbo: "REGIONALE_2", sens_circu: "Sens direct" } },
      { geometry: [[100, 100, 900, 100]], properties: { symbo: "NON_CLASSEE_RESTREINT" } }
    ),
    15,
    TILE
  );
  assert.equal(lanes.lanes.length, LANE_STRIDE);
  const [start, count, , direction, cars] = lanes.lanes;
  assert.equal(direction, 1);
  assert.ok(cars! > 0);
  for (let i = start!; i < start! + count!; i++) {
    assert.ok(lanes.points[2 * i]! >= 0 && lanes.points[2 * i]! <= 1);
    assert.ok(lanes.points[2 * i + 1]! >= 0 && lanes.points[2 * i + 1]! <= 1.0001);
  }
});

test("voitures : restent sur leur voie, dans leur sens, en boucle", () => {
  const lanes = roadLanes(roads({ geometry: [[0, 2048, 4096, 2048]], properties: { symbo: "REGIONALE_2", sens_circu: "Sens inverse" } }), 15, TILE);
  const traffic = new Traffic(lanes);
  const cars = new Float32Array(traffic.count * 4);
  assert.ok(traffic.count > 5);
  for (let frame = 0; frame < 200; frame++) {
    traffic.step(0.5);
    traffic.write(cars);
    for (let c = 0; c < traffic.count; c++) {
      assert.ok(cars[c * 4]! >= 0 && cars[c * 4]! <= 1);
      assert.ok(Math.abs(cars[c * 4 + 1]! - lanes.points[1]!) < 1e-6);
      // Sens inverse du trace (d'ouest en est) : vers l'ouest ; plus petite aux bouts de la voie, jamais nulle.
      assert.ok(cars[c * 4 + 2]! < 0 && cars[c * 4 + 2]! >= -1);
    }
  }
});

test("bateaux : sur la ligne d'un fleuve qui passe sur l'eau, pas sur celle d'un ruisseau", () => {
  const water = vectorLayer(E, [{ type: GEOMETRY.polygon, geometry: [[0, 1800, 4096, 1800, 4096, 2300, 0, 2300, 0, 1800]] }]);
  const names = vectorLayer(E, [
    { type: GEOMETRY.line, geometry: [[0, 2048, 4096, 2048]] },
    { type: GEOMETRY.line, geometry: [[0, 3500, 4096, 3500]] },
  ]);
  const lanes = boatLanes(new Map([["hydro_surf", water], ["toponyme_hydro_lin", names]]), 15, TILE);
  assert.equal(lanes.lanes.length, LANE_STRIDE);
  assert.ok(Math.abs(lanes.points[1]! - 0.5) < 0.01);
});
