import assert from "node:assert/strict";
import { test } from "node:test";
import { flightPath } from "./FlightPath.ts";

const close = (a: number, b: number, tolerance = 1e-6) => assert.ok(Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(b)), `${a} != ${b}`);

test("vol : part de la vue de depart, arrive sur celle d'arrivee", () => {
  const path = flightPath(4, 3, 660, 0.8);
  close(path.width(0), 4);
  close(path.progress(0), 0);
  close(path.width(path.length), 3);
  close(path.progress(path.length), 1);
});

test("vol : dezoome en chemin, d'autant plus que rho est grand", () => {
  const peak = (rho: number) => {
    const path = flightPath(4, 4, 660, rho);
    return Math.max(...Array.from({ length: 101 }, (_, i) => path.width((i / 100) * path.length)));
  };
  assert.ok(peak(0.8) > 100 && peak(0.8) < 400, `${peak(0.8)}`);
  assert.ok(peak(1.42) > peak(0.8));
});

test("vol sur place : zoom seul", () => {
  const path = flightPath(30, 4, 0, 0.8);
  close(path.width(0), 30);
  close(path.width(path.length), 4);
  assert.equal(path.progress(path.length / 2), 1);
});
