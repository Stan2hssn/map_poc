import assert from "node:assert/strict";
import { test } from "node:test";
import { sampleEase } from "./ease.ts";
import { sampleTrack, Theatre } from "./Theatre.ts";

test("une piste tient sa valeur de bord hors de ses cles et interpole entre elles", () => {
  const track = [
    { t: 1, v: 0, e: "linear" },
    { t: 3, v: 10 },
  ];
  assert.equal(sampleTrack(track, 0), 0);
  assert.equal(sampleTrack(track, 2), 5);
  assert.equal(sampleTrack(track, 9), 10);
});

test("l'ease de la cle de depart gouverne le segment qui la suit", () => {
  const track = [
    { t: 0, v: 0, e: "hold" },
    { t: 1, v: 1 },
  ];
  assert.equal(sampleTrack(track, 0.99), 0);
  assert.equal(sampleTrack(track, 1), 1);
  assert.equal(sampleEase("easeInOut", 0.5), 0.5);
});

test("le theatre ecrit ses pistes dans la scene a mesure qu'il avance, et s'arrete a la fin", () => {
  let progress = -1;
  const theatre = new Theatre({
    id: "intro",
    duration: 2,
    bindings: { passage: { progres: { get: () => progress, set: (v) => (progress = v) } } },
    tracks: { passage: { progres: [{ t: 0, v: 0, e: "linear" }, { t: 2, v: 1 }] } },
  });
  assert.equal(progress, 0);
  theatre.play();
  theatre.advance(1);
  assert.equal(progress, 0.5);
  theatre.advance(5);
  assert.equal(progress, 1);
  assert.equal(theatre.playing, false);
});
