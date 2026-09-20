import assert from "node:assert/strict";
import test from "node:test";
import { signedDistanceField } from "./DistanceField.ts";

/** Carre plein de 8 x 8 au milieu d'une image de 16 x 16. */
function square(): Uint8Array {
  const mask = new Uint8Array(16 * 16);
  for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) mask[y * 16 + x] = 255;
  return mask;
}

test("champ signe : 0,5 sur le bord, plus haut dedans, plus bas dehors", () => {
  const field = signedDistanceField(square(), 16, 16, 4);
  const at = (x: number, y: number) => field[y * 16 + x]!;
  assert.ok(at(8, 8) > 200, `centre trop bas : ${at(8, 8)}`);
  assert.ok(at(0, 0) < 40, `coin trop haut : ${at(0, 0)}`);
  // Le premier pixel dedans et le premier dehors encadrent le bord.
  assert.ok(at(4, 8) > 128 && at(3, 8) < 128, `bord mal place : ${at(3, 8)} / ${at(4, 8)}`);
});

test("champ signe : la distance croit en s'eloignant du bord", () => {
  const field = signedDistanceField(square(), 16, 16, 6);
  const at = (x: number, y: number) => field[y * 16 + x]!;
  assert.ok(at(3, 8) > at(2, 8), "la valeur doit baisser en s'eloignant dehors");
  assert.ok(at(2, 8) > at(1, 8), "la valeur doit baisser en s'eloignant dehors");
  assert.ok(at(5, 8) > at(4, 8), "la valeur doit monter en s'enfoncant dedans");
});

test("image vide : tout est dehors, loin du bord", () => {
  const field = signedDistanceField(new Uint8Array(16 * 16), 16, 16, 4);
  assert.equal(field[0], 0);
  assert.equal(field[8 * 16 + 8], 0);
});
