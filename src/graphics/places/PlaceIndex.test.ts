import assert from "node:assert/strict";
import { test } from "node:test";
import { PlaceIndex, type Place } from "./PlaceIndex.ts";

const place = (name: string, lon: number, lat: number, population: number, country = "FRA"): Place => ({
  name,
  lon,
  lat,
  population,
  country,
});
const FRANCE = { west: -5, east: 10, south: 41, north: 51 };

test("les plus peuples d'abord, dans l'emprise seulement", () => {
  const index = new PlaceIndex();
  index.add([place("Lyon", 4.83, 45.76, 1_400_000), place("Londres", -0.12, 51.5, 8_900_000, "GBR"), place("Paris", 2.35, 48.85, 9_900_000)]);
  assert.deepEqual(
    index.pick(FRANCE, 5).map((p) => p.name),
    ["Paris", "Lyon"]
  );
  assert.deepEqual(
    index.pick(FRANCE, 1).map((p) => p.name),
    ["Paris"]
  );
});

test("le filtre ecarte sans compter dans la limite", () => {
  const index = new PlaceIndex();
  index.add([place("Paris", 2.35, 48.85, 9_900_000), place("Versailles", 2.13, 48.8, 150_000), place("Lyon", 4.83, 45.76, 1_400_000)]);
  const far = index.pick(FRANCE, 2, (p) => p.name !== "Lyon");
  assert.deepEqual(
    far.map((p) => p.name),
    ["Paris", "Versailles"]
  );
});

test("un meme lieu venu de deux sources garde la plus grande population", () => {
  const index = new PlaceIndex();
  index.add([place("Paris", 2.35, 48.85, 9_900_000), place("Saint-Etienne", 4.39, 45.43, 290_000)]);
  index.add([place("Paris", 2.34, 48.86, 2_100_000), place("Saint-Étienne", 4.4, 45.44, 170_000), place("Saint-Denis", 2.36, 48.94, 149_000)]);
  index.add([place("Rome", 12.5, 41.9, 3_300_000, "ITA"), place("Paris", 2.35, 48.85, 11_000_000)]);
  assert.equal(index.version, 3);
  assert.deepEqual(
    index.pick({ west: -180, east: 180, south: -90, north: 90 }, 9).map((p) => `${p.name}:${p.population}`),
    ["Paris:11000000", "Rome:3300000", "Saint-Etienne:290000", "Saint-Denis:149000"]
  );
});

test("les lieux deux cents fois moins peuples que le premier sont ignores", () => {
  const index = new PlaceIndex();
  index.add([place("Tokyo", 139.7, 35.7, 36_900_000, "JPN"), place("Base", 39.6, -69, 100, "ATA"), place("Lima", -77, -12, 8_000_000, "PER")]);
  assert.deepEqual(
    index.pick({ west: -180, east: 180, south: -90, north: 90 }, 5).map((p) => p.name),
    ["Tokyo", "Lima"]
  );
});
