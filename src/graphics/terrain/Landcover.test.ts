import assert from "node:assert/strict";
import { test } from "node:test";
import { drawLandcoverTile, landcoverZoom, mercatorTiles, tilePointToLonLat, type Pen } from "./Landcover.ts";
import { GEOMETRY, vectorLayer } from "./VectorTile.ts";

const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test("zoom : une tuile dessinee a 512 px vaut la resolution de l'image", () => {
  // 1 degre de longitude sur 2048 px : une tuile de 512 px couvre 1/4 de degre, 2^z = 1440, z = 10,5.
  assert.equal(landcoverZoom({ west: 2, east: 3, south: 48, north: 49 }, 2048), 10);
  assert.equal(landcoverZoom({ west: 2.3, east: 2.4, south: 48.8, north: 48.9 }, 2048), 14);
  assert.equal(landcoverZoom({ west: 2.35, east: 2.351, south: 48.85, north: 48.851 }, 2048), 16);
});

test("coins de tuile et tuiles couvrant une emprise", () => {
  const [lon, lat] = tilePointToLonLat(1, { x: 1, y: 0 }, 0, 4096, 4096);
  close(lon, 0);
  close(lat, 0);
  const [, north] = tilePointToLonLat(0, { x: 0, y: 0 }, 0, 0, 4096);
  close(north, 85.0511287798, 1e-6);
  const tiles = mercatorTiles(12, { west: 2.3, east: 2.4, south: 48.8, north: 48.9 });
  assert.ok(tiles.length >= 4 && tiles.length <= 9);
  const xs = tiles.map((t) => t.x);
  assert.deepEqual([Math.min(...xs), Math.max(...xs)], [2074, 2075]);
});

test("dessin : couleurs par couche, polygones remplis, routes a leur largeur", () => {
  const calls: string[] = [];
  const pen = (): Pen =>
    ({
      beginPath: () => calls.push("begin"),
      moveTo: (x: number, y: number) => calls.push(`move ${x.toFixed(0)},${y.toFixed(0)}`),
      lineTo: (x: number, y: number) => calls.push(`line ${x.toFixed(0)},${y.toFixed(0)}`),
      closePath: () => {},
      fill: () => calls.push("fill"),
      stroke: () => calls.push("stroke"),
      set fillStyle(v: string) {
        calls.push(`fillStyle ${v}`);
      },
      set strokeStyle(v: string) {
        calls.push(`strokeStyle ${v}`);
      },
      set lineWidth(v: number) {
        calls.push(`width ${v.toFixed(1)}`);
      },
      lineCap: "round",
      lineJoin: "round",
      globalCompositeOperation: "source-over",
    }) as unknown as Pen;
  const square = vectorLayer(4096, [{ type: GEOMETRY.polygon, geometry: [[0, 0, 4096, 0, 4096, 4096, 0, 4096, 0, 0]] }]);
  const road = vectorLayer(4096, [{ type: GEOMETRY.line, properties: { symbo: "LOCALE_1" }, geometry: [[0, 2048, 4096, 2048]] }]);
  // La tuile 0/0/0 couvre la carte entiere ; la toile, une bande autour de l'equateur.
  const canvas = { bounds: { west: -180, east: 180, south: -10, north: 10 }, width: 360, height: 20 };
  drawLandcoverTile(pen(), pen(), new Map([["bati_surf", square], ["routier_route", road]]), 0, { x: 0, y: 0 }, canvas);
  assert.ok(calls.includes("fillStyle #ff0000"));
  assert.ok(calls.includes("move 0,-75"), calls.join(" | "));
  assert.ok(calls.includes("fill"));
  assert.ok(calls.includes("strokeStyle #ffffff"));
  assert.ok(calls.includes("move 0,10") && calls.includes("line 360,10"));
  // 9 m sur une toile ou un pixel vaut ~111 km : largeur minimale d'un demi-pixel.
  assert.ok(calls.includes("width 0.5"));
});
