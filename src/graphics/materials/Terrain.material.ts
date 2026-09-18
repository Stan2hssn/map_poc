import { DataTexture, HalfFloatType, LinearFilter, Matrix4, RedFormat, RepeatWrapping, RGBAFormat, UnsignedByteType, Vector2, Vector3, Vector4 } from "three";
import {
  Break,
  cameraPosition,
  cameraViewMatrix,
  abs,
  directionToColor,
  mrt,
  normalView,
  color,
  float,
  Fn,
  fwidth,
  If,
  int,
  length,
  log2,
  luminance,
  Loop,
  max,
  mix,
  normalize,
  output,
  positionGeometry,
  positionWorld,
  smoothstep,
  step,
  texture,
  uniform,
  vec2,
  vec3,
  vec4,
  vertexStage,
} from "three/tsl";
import { MeshStandardNodeMaterial, type Node, type TextureNode } from "three/webgpu";
import { TERRAIN_CONFIG } from "@graphics/config/terrain.config.ts";
import { inkCoverage, inkOnPaper, inkSettings, paperAt, type InkAnchor } from "@graphics/postprocessing/effects/InkStyle.ts";
import { PEAK_CELL } from "@graphics/terrain/Buildings.ts";

/** Ecart des echantillons de pente, en texels : au-dela de 1, le modele est adouci. */
const NORMAL_SPREAD = 1.5;
/** Assombrissement des creux : anneau proche lu dans le detail, anneau large dans l'apercu (rayons en texels du detail). */
const NEAR_RING = { radius: 3, samples: 4 };
const FAR_RING = { radius: 12, samples: 8 };
/** Mer (altitude <= 0) : teinte, et decroche sous la cote en unites de scene. */
const SEA_COLOR = 0x5c5c5c;
const SEA_DROP = 0.3;
/** Le sol s'efface dans le fond entre ces distances du centre (unites de scene). */
export const GROUND_FADE = { near: 70, far: 145 };
/** Texture de donnees : encre du bati et de ses contours, eau, vegetation, routes couleur papier. */
const INK = 0x24345c;
const INK_DARK = 0x141c33;
const WATER = 0x7d8db0;
const PAPER = 0xf7f4ec;
/** Hachures par cellule de bruit de brume (3 a 6 cellules sur la largeur de la vue). */
const HATCHES_PER_CELL = 30;
/** Cellules de bruit sur une repetition de la texture de brume. */
const NOISE_CELLS = 8;
/** Bati en relief, facon maquette d'argile. */
export const CLAY = 0xece8e1;
/** Parallaxe : bornes des boucles (les pas reels sont des reglages, `terrainSettings.parallax*`). */
const MAX_COARSE_STEPS = 48;
const MAX_FINE_STEPS = 96;
const MAX_SHADOW_STEPS = 24;
/** Dichotomies apres l'impact : la position du mur a 1/8 de pas pres. */
const REFINE_STEPS = 3;
/** Bruit du bord du masque : cellules de bruit par cellule de brume (accroche a la carte), et sa derive par rapport a la brume. */
const MASK_FREQUENCY = 2;
const MASK_DRIFT = 4;
const M = TERRAIN_CONFIG.mask;
/** Creux au pied du bati : hauteurs moyennes sur un anneau (rayon en texels, lu a 2^lod texels), ecart (m) ou il sature, force. */
const CONTACT = { radius: 5, lod: 2.5, rangeM: 25 };
const ring = (samples: number) =>
  Array.from({ length: samples }, (_, i) => [Math.cos((i * 2 * Math.PI) / samples), Math.sin((i * 2 * Math.PI) / samples)] as const);

/**
 * Bruit fractal periodique calcule une fois : la brume le lit en deux echantillons
 * au lieu d'evaluer du bruit a chaque pixel (~3 ms par image).
 */
function createNoiseTexture(size = 256): DataTexture {
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const values = new Float32Array(size * size);
  for (let octave = 0; octave < 3; octave++) {
    const n = NOISE_CELLS << octave;
    const lattice = Float32Array.from({ length: n * n }, random);
    const at = (x: number, y: number) => lattice[(y % n) * n + (x % n)]!;
    for (let y = 0; y < size; y++) {
      const y0 = Math.floor((y / size) * n);
      const ty = smooth((y / size) * n - y0);
      for (let x = 0; x < size; x++) {
        const x0 = Math.floor((x / size) * n);
        const tx = smooth((x / size) * n - x0);
        const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx;
        const bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx;
        values[y * size + x] += (top + (bottom - top) * ty) / 2 ** octave;
      }
    }
  }
  // Moyenne 0,5 et ecart type 0,16, comme le bruit de Perlin qu'il remplace.
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const deviation = Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length);
  const data = Uint8Array.from(values, (v) => Math.round(Math.min(1, Math.max(0, 0.5 + ((v - mean) / deviation) * 0.16)) * 255));
  const noise = new DataTexture(data, size, size, RedFormat, UnsignedByteType);
  noise.wrapS = noise.wrapT = RepeatWrapping;
  noise.minFilter = noise.magFilter = LinearFilter;
  noise.needsUpdate = true;
  return noise;
}

export const terrainSettings = {
  /** Detail : altitudes (0 dans les trous) et part de donnees par texel. */
  heights: texture(new DataTexture(new Uint16Array(1), 1, 1, RedFormat, HalfFloatType)),
  valid: texture(new DataTexture(new Uint8Array(1), 1, 1, RedFormat, UnsignedByteType)),
  /** Apercu complet, pris la ou le detail manque. */
  coarseHeights: texture(new DataTexture(new Uint16Array(1), 1, 1, RedFormat, HalfFloatType)),
  /** uv du bloc (0..1) vers uv de chaque mosaique. */
  uvOffset: uniform(new Vector2()),
  uvScale: uniform(new Vector2(1, 1)),
  coarseOffset: uniform(new Vector2()),
  coarseScale: uniform(new Vector2(1, 1)),
  /** Taille de l'apercu en texels. */
  coarseSize: uniform(new Vector2(1, 1)),
  /** Altitude (m) posee sur le haut du socle, relief affiche (m), et unites de scene par metre. */
  floor: uniform(0),
  relief: uniform(1000),
  heightScale: uniform(0.001),
  /** Taille du bloc dans la scene : largeur, profondeur. */
  blockSize: uniform(new Vector2(100, 100)),
  /** Un texel de la mosaique, en uv du bloc. */
  texel: uniform(new Vector2(1e-3, 1e-3)),
  occlusion: uniform(1.5),
  /** Emprise en degres : coin nord-ouest, etendue (latitude vers le sud), cosinus de la latitude centrale. */
  geoOrigin: uniform(new Vector2()),
  geoSize: uniform(new Vector2(1, -1)),
  geoCos: uniform(1),
  /** Brume : densite, et deux echelles de bruit fondues pendant le zoom pour qu'elle reste accrochee au sol. */
  mist: uniform(0.55),
  mistNoise: texture(createNoiseTexture()),
  /** Decalage lent du bruit de brume. */
  mistDrift: uniform(new Vector2()),
  mistScales: uniform(new Vector2(1, 0.5)),
  mistBlend: uniform(0),
  /** Camera principale : la grille de l'ecran est projetee depuis elle, y compris dans la passe d'ombre. */
  viewOrigin: uniform(new Vector3()),
  viewWorld: uniform(new Matrix4()),
  viewProjectionInverse: uniform(new Matrix4()),
  /** Au-dela, un rayon qui rase l'horizon s'arrete. */
  groundReach: uniform(320),
  /** Texture de donnees (R bati, G vegetation, B eau, A routes) et son cadrage en uv du bloc. */
  landcover: texture(new DataTexture(new Uint8Array(4), 1, 1, RGBAFormat, UnsignedByteType)),
  landcoverOffset: uniform(new Vector2()),
  landcoverScale: uniform(new Vector2(1, 1)),
  landcoverStrength: uniform(1),
  /** Hauteurs du bati (m) sur la zone fine, leur cadrage en uv du bloc, taille en texels, plus grande hauteur (m). */
  buildingHeights: texture(new DataTexture(new Uint8Array(1), 1, 1, RedFormat, UnsignedByteType)),
  buildingOffset: uniform(new Vector2()),
  buildingScale: uniform(new Vector2(1, 1)),
  buildingSize: uniform(new Vector2(1, 1)),
  buildingMax: uniform(0),
  /** Sommets par cellule de `PEAK_CELL` texels, etendus aux voisines : la ou la parallaxe peut s'arreter. */
  buildingPeaks: texture(new DataTexture(new Uint8Array(1), 1, 1, RedFormat, UnsignedByteType)),
  /** Sommets des environs (cellules de `SUMMIT_CELL` texels) : la parallaxe part de la, pas du plus haut batiment de la zone. */
  buildingSummits: texture(new DataTexture(new Uint8Array(1), 1, 1, RedFormat, UnsignedByteType)),
  /** Unites de scene par metre de bati (0 : pas de bati), apparition de 0 a 1, parallaxe (1) ou volumes a part (0). */
  buildingUnits: uniform(0),
  buildingGrow: uniform(0),
  parallax: uniform(0),
  /** Direction du soleil, vers lui. */
  sun: uniform(new Vector3(0, 1, 0)),
  /** Zone dessinee (voir `TERRAIN_CONFIG.mask`) ; centre pose chaque image sous la camera principale. */
  maskCenter: uniform(new Vector2()),
  maskShift: uniform(M.shift as number),
  maskRadius: uniform(new Vector2(...M.radius)),
  maskSoftness: uniform(M.softness as number),
  maskJitter: uniform(M.jitter as number),
  /** Dessin a l'encre (0 ou 1) : hachures a la plume du bati, sol qui s'efface vers le papier (blanc) plutot que vers le noir. */
  pen: uniform(0),
  /** Encre dessinee ici meme (parallaxe, une seule passe) plutot que par l'effet plein ecran. */
  inkDirect: uniform(0),
  /**
   * Motifs d'encre accroches a la carte, a deux echelles (celles de la brume) : pseudo-pixels par unite
   * de `geo`, et ecart (en `geo`) entre le coin de la vue et une origine recalee d'une periode entiere
   * (`INK_PERIOD`), calcule en double precision cote CPU.
   */
  inkScale: uniform(new Vector2(1, 1)),
  inkOrigin: uniform(new Vector4()),
  /**
   * Parallaxe, de quoi arbitrer qualite et cout : pas par cellule de sommets et fins (au plus), texels par pas fin,
   * pas vers le soleil (0 : sans ombres du bati) et penombre par metre, decalage du niveau de mip
   * (plus haut : moins de lectures fines, bords plus doux), force du creux au pied du bati.
   */
  coarseSteps: uniform(24),
  fineSteps: uniform(24),
  stepTexels: uniform(2),
  shadowSteps: uniform(10),
  shadowSoftness: uniform(0.12),
  lodBias: uniform(0),
  contact: uniform(0.45),
};

const s = terrainSettings;
const read = (map: TextureNode, uv: Node) => (map.sample(uv) as TextureNode).level(float(0)).r;
// Hors de la mosaique du detail (en vol, elle suit avec retard), seul l'apercu compte.
const inside = (uv: Node) => step(0, uv.x).mul(step(uv.x, 1)).mul(step(0, uv.y)).mul(step(uv.y, 1));

/**
 * 1 dans la zone dessinee, 0 au-dela, au point `xz` de la scene : disque sous la camera, bord fondu,
 * irregulier et qui respire lentement. Lisible aussi dans le vertex shader.
 */
export function drawnMask(xz: Node): Node {
  const distance = length(xz.sub(s.maskCenter).div(s.maskRadius));
  // Bord accroche a la carte : il glisse avec elle au lieu de rester colle a l'ecran.
  const geo = s.geoOrigin.add(xz.div(s.blockSize).add(0.5).mul(s.geoSize)).mul(vec2(s.geoCos, 1));
  const at = (scale: Node) => read(s.mistNoise, geo.mul(scale).mul(MASK_FREQUENCY / NOISE_CELLS).add(s.mistDrift.mul(MASK_DRIFT)));
  const noise = mix(at(s.mistScales.x), at(s.mistScales.y), s.mistBlend);
  const edge = distance.add(noise.sub(0.5).mul(s.maskJitter));
  return smoothstep(s.maskSoftness.oneMinus(), 1, edge).oneMinus();
}

// L'apercu est tres agrandi : une B-spline en 4 lectures bilineaires evite les facettes.
function smoothRead(map: TextureNode, uv: Node, size: Node): Node {
  const p = uv.mul(size).sub(0.5);
  const i = p.floor();
  const f = p.sub(i);
  const f2 = f.mul(f);
  const f3 = f2.mul(f);
  const w0 = f.oneMinus().pow(3).div(6);
  const w1 = f3.mul(3).sub(f2.mul(6)).add(4).div(6);
  const w3 = f3.div(6);
  const g0 = w0.add(w1);
  const g1 = g0.oneMinus();
  const h0 = i.sub(0.5).add(w1.div(g0)).div(size);
  const h1 = i.add(1.5).add(w3.div(g1.max(1e-4))).div(size);
  const row = (y: Node) => read(map, vec2(h0.x, y)).mul(g0.x).add(read(map, vec2(h1.x, y)).mul(g1.x));
  return row(h0.y).mul(g0.y).add(row(h1.y).mul(g1.y));
}

function coarseAt(blockUv: Node, smooth: boolean): Node {
  const uv = s.coarseOffset.add(blockUv.mul(s.coarseScale));
  return smooth ? smoothRead(s.coarseHeights, uv, s.coarseSize) : read(s.coarseHeights, uv);
}

/**
 * Altitude (m) au point `blockUv` du bloc, a lire dans le vertex shader. `detailed` a faux : apercu brut, moins cher.
 * Le filtrage melange altitudes et zeros des trous : divise par la part de donnees, il redonne la moyenne des texels valides.
 */
export function terrainMeters(blockUv: Node, detailed = true): Node {
  const coarse = coarseAt(blockUv, detailed);
  if (!detailed) return coarse;
  const uv = s.uvOffset.add(blockUv.mul(s.uvScale));
  const weight = read(s.valid, uv).mul(inside(uv));
  return mix(coarse, read(s.heights, uv).div(weight.max(1e-3)), weight);
}

/** 1 au centre du sol, 0 au-dela de `GROUND_FADE.far`, pour un point `blockUv` du bloc. `smoothstep` veut ses bornes dans l'ordre (Metal). */
export function groundFade(blockUv: Node): Node {
  return smoothstep(GROUND_FADE.near, GROUND_FADE.far, length(blockUv.sub(0.5).mul(s.blockSize))).oneMinus();
}

/** Hauteur dans la scene au point `blockUv` du bloc (vertex shader). */
export function terrainHeight(blockUv: Node, detailed = true): Node {
  return terrainMeters(blockUv, detailed).sub(s.floor).mul(s.heightScale);
}

/** Point du sol (y = 0) vu au point `screen` de l'ecran (0 a 1) depuis la camera principale. */
function groundFromScreen(screen: Node): Node {
  const clip = s.viewProjectionInverse.mul(vec4(screen.mul(2).sub(1), 1, 1));
  const far = s.viewWorld.mul(vec4(clip.xyz.div(clip.w), 1)).xyz;
  const ray = normalize(far.sub(s.viewOrigin));
  const distance = s.viewOrigin.y.div(ray.y.negate().max(1e-4)).min(s.groundReach);
  return s.viewOrigin.add(ray.mul(distance));
}

/** Hachures : 1 sur les traits, epais de `width` (fraction de l'ecart), lisses a l'ecran. */
function hatch(coord: Node, width: Node | number = 0.12): Node {
  const distance = abs(coord.add(0.5).fract().sub(0.5));
  const aa = fwidth(coord);
  const w = typeof width === "number" ? float(width) : width;
  return smoothstep(w, aa.add(w), distance).oneMinus();
}

/** Encre directe : distance (unites de scene) ou le trait s'eclaircit. */
const INK_DISTANCE = { near: 60, far: 220 };

/** Traits a la plume accroches au sol, le long de `along` (degres, longitude x cosinus) ; deux echelles fondues pendant le zoom. */
export function penLines(along: Node, width: Node | number = 0.12): Node {
  const at = (scale: Node) => hatch(along.mul(scale).mul(HATCHES_PER_CELL), width);
  return mix(at(s.mistScales.x), at(s.mistScales.y), s.mistBlend);
}

/**
 * Dessine la texture de donnees sur le relief, facon carte imprimee : vegetation hachuree, eau en traits
 * horizontaux, routes en reserve de papier, bati a l'encre bleue cerne plus fonce.
 * Hachures accrochees au sol, fondues entre deux echelles pendant le zoom (comme la brume).
 */
/** Texture de donnees au point `blockUv` : aplats (bords nets a toute echelle) et contours, par canal. */
function landcoverAt(blockUv: Node): { fill: Node; outline: Node } {
  const at = s.landcoverOffset.add(blockUv.mul(s.landcoverScale));
  const data = s.landcover.sample(at).mul(inside(at));
  const edge = fwidth(data).max(1e-3);
  return {
    fill: smoothstep(edge.negate().add(0.5), edge.add(0.5), data),
    outline: smoothstep(vec4(0), edge.mul(1.5), abs(data.sub(0.5))).oneMinus(),
  };
}

function drawLandcover(relief: Node, { fill, outline }: { fill: Node; outline: Node }, geo: Node, drawn: Node): Node {
  // A l'encre directe, vegetation et eau prennent leurs propres motifs (`inkCoverage`).
  const hatched = s.inkDirect.oneMinus();
  const diagonal = penLines(geo.x.add(geo.y)).mul(hatched);
  const horizontal = penLines(geo.y).mul(hatched);

  let paper: Node = mix(relief, color(0xcfd5e2), fill.g.mul(0.35));
  paper = mix(paper, color(INK), fill.g.mul(diagonal).mul(0.45));
  paper = mix(paper, color(WATER), fill.b.mul(0.55));
  paper = mix(paper, color(INK), fill.b.mul(horizontal).mul(0.3));
  paper = mix(paper, color(PAPER), fill.a.mul(0.85));
  // En relief, le bati devient argile : son dessin a plat s'efface.
  const flat = s.buildingGrow.mul(drawn).oneMinus();
  paper = mix(paper, color(INK), fill.r.mul(0.42).mul(flat));
  paper = mix(paper, color(INK_DARK), outline.r.mul(0.85).mul(flat));
  return mix(relief, paper, s.landcoverStrength.mul(drawn));
}

/**
 * Motifs d'encre accroches a la carte au point `blockUv` du bloc : ecart au coin de la vue (petit, donc
 * precis) recale sur l'origine calculee cote CPU, aux deux echelles de la brume.
 */
function inkAnchorOf(blockUv: Node): InkAnchor {
  const fromCorner = blockUv.mul(s.geoSize).mul(vec2(s.geoCos, 1));
  return {
    at: fromCorner.add(s.inkOrigin.xy).mul(s.inkScale.x),
    next: fromCorner.add(s.inkOrigin.zw).mul(s.inkScale.y),
    blend: s.mistBlend,
  };
}

/** Meme ancre, depuis un point `xz` de la scene : pour l'effet plein ecran. */
export const inkAnchorAt = (xz: Node): InkAnchor => inkAnchorOf(xz.div(s.blockSize).add(0.5));

/** Hauteur du bati (m) au point `at` de sa texture, et sommet de sa cellule. */
const buildingMeters = (at: Node, lod: Node) => (s.buildingHeights.sample(at) as TextureNode).level(lod).r.mul(255);
const peakMeters = (at: Node) => (s.buildingPeaks.sample(at) as TextureNode).level(float(0)).r.mul(255);
const summitMeters = (at: Node) => (s.buildingSummits.sample(at) as TextureNode).level(float(0)).r.mul(255);
const buildingsOn = (at: Node, units: Node) => s.parallax.mul(units).mul(s.buildingMax).mul(inside(at)).greaterThan(0);

/**
 * Parallaxe du bati depuis le sol : le rayon qui touche le sol en ce pixel est remonte jusqu'a la hauteur
 * du plus haut batiment, puis redescendu vers le sol ; le premier batiment qu'il traverse est ce que l'on voit.
 * D'abord une cellule de sommets par pas, jusqu'a la premiere qui peut l'arreter, puis un texel par pas.
 * Hauteurs mesurees au-dessus du plan tangent au sol (`normal`), `units` unites de scene par metre (masque compris).
 * Rend (uv du point touche, hauteur en m, 0 si rien, sinon 1 + part de mur).
 * Lectures a niveau de mip explicite : les boucles s'arretent a des pas differents selon les pixels.
 */
const parallaxHit = Fn(([at, normal, lod, units]: [Node, Node, Node, Node]) => {
  const hit = vec4(0).toVar();
  If(buildingsOn(at, units), () => {
    const dir = normalize(positionWorld.sub(cameraPosition));
    const perUnit = dir.xz.div(s.blockSize).mul(s.buildingScale);
    const texelsPerUnit = length(perUnit.mul(s.buildingSize)).max(1e-6);
    // Hauteur du rayon (m) par unite parcourue vers la camera.
    const climb = dir.dot(normal).negate().div(normal.y).max(0.05).div(units);
    // Depart a hauteur du plus haut sommet des environs : dans une ville de 20 m, pas de marche depuis 255 m.
    const top = summitMeters(at).div(climb);
    const cell = float(PEAK_CELL).div(texelsPerUnit).max(top.div(s.coarseSteps));
    const entry = float(0).toVar();
    Loop(MAX_COARSE_STEPS, ({ i }) => {
      const distance = top.sub(cell.mul(float(i)));
      If(distance.lessThanEqual(0).or(float(i).greaterThanEqual(s.coarseSteps)), () => {
        Break();
      });
      // Bas du pas sous le sommet de la cellule : un batiment peut arreter le rayon ici.
      If(distance.sub(cell).max(0).mul(climb).lessThan(peakMeters(at.sub(perUnit.mul(distance)))), () => {
        entry.assign(distance);
        Break();
      });
    });

    If(entry.greaterThan(0), () => {
      // `stepTexels` texels du niveau de mip lu par pas (la dichotomie rattrape la precision) : loin, moins de pas.
      const steps = entry.mul(texelsPerUnit).div(lod.exp2().mul(s.stepTexels)).ceil().clamp(1, s.fineSteps);
      const spacing = entry.div(steps);
      const lastHeight = float(0).toVar();
      Loop({ start: int(0), end: int(MAX_FINE_STEPS), condition: "<=" }, ({ i }) => {
        const index = float(i);
        If(index.greaterThan(steps), () => {
          Break();
        });
        // Dernier pas exactement sur le sol : un arrondi l'y ferait passer dessous.
        const distance = entry.mul(index.div(steps).oneMinus());
        const height = buildingMeters(at.sub(perUnit.mul(distance)), lod);
        const gap = climb.mul(distance).sub(height);
        // Nettement sous un toit : le sol lui-meme n'est pas un batiment.
        If(gap.lessThan(-0.05), () => {
          // Dichotomie entre le dernier point au-dessus et le premier dessous : des pas plus grands suffisent.
          const above = distance.add(spacing).min(entry).toVar();
          const below = distance.toVar();
          for (let r = 0; r < REFINE_STEPS; r++) {
            const middle = above.add(below).mul(0.5);
            const under = climb.mul(middle).sub(buildingMeters(at.sub(perUnit.mul(middle)), lod)).lessThan(-0.05);
            If(under, () => {
              below.assign(middle);
            }).Else(() => {
              above.assign(middle);
            });
          }
          const back = above.add(below).mul(0.5);
          // Mur : la hauteur a monte plus vite que le rayon n'est descendu.
          const wall = smoothstep(0.5, 1.5, height.sub(lastHeight).div(climb.mul(spacing)));
          hit.assign(vec4(at.sub(perUnit.mul(back)), climb.mul(back), wall.add(1)));
          Break();
        });
        lastHeight.assign(height);
      });
    });
  });
  return hit;
});

/** Normale (monde) du bati au point `at` : vers le haut sur les toits, selon la pente des hauteurs sur les murs. */
function buildingNormal(at: Node, wall: Node, lod: Node): Node {
  const texel = vec2(1).div(s.buildingSize);
  const across = (offset: Node) => buildingMeters(at.add(offset), lod).sub(buildingMeters(at.sub(offset), lod));
  const perUnit = s.buildingScale.div(s.blockSize);
  const outward = vec3(across(vec2(texel.x, 0)).mul(perUnit.x).negate(), 0, across(vec2(0, texel.y)).mul(perUnit.y).negate());
  // Pente nulle (milieu d'un aplat) : le mur fait face a la camera.
  const facing = normalize(cameraPosition.sub(positionWorld)).mul(vec3(1e-4, 0, 1e-4));
  return normalize(mix(vec3(0, 1, 0), normalize(outward.add(facing)), wall));
}

/**
 * Part de soleil au point `at`, a `meters` au-dessus du sol : ombres douces du bati, marchees vers le soleil
 * jusqu'au sommet des cellules voisines (les ombres des tours isolees s'arretent la).
 */
const parallaxLight = Fn(([at, meters, lod, units]: [Node, Node, Node, Node]) => {
  const lit = float(1).toVar();
  If(buildingsOn(at, units).and(s.sun.y.greaterThan(0.05)).and(s.shadowSteps.greaterThan(0)), () => {
    const reach = peakMeters(at).sub(meters).max(0).mul(units).div(s.sun.y);
    const perUnit = s.sun.xz.div(s.blockSize).mul(s.buildingScale);
    Loop(MAX_SHADOW_STEPS, ({ i }) => {
      If(float(i).greaterThanEqual(s.shadowSteps), () => {
        Break();
      });
      const distance = float(i).add(1).div(s.shadowSteps).mul(reach);
      const ray = meters.add(s.sun.y.mul(distance).div(units)).add(1);
      const spread = distance.div(units).mul(s.shadowSoftness).max(1);
      lit.assign(lit.min(ray.sub(buildingMeters(at.add(perUnit.mul(distance)), lod)).div(spread).add(0.5).clamp(0, 1)));
    });
  });
  return lit;
});

/** Creux au pied du bati : plus sombre la ou les batiments voisins depassent le point. */
function contactShade(at: Node, meters: Node, lod: Node, drawn: Node): Node {
  // Quatre lectures en croix plutot qu'un mip grossier, qui dessinerait ses texels en carres.
  const reach = vec2(CONTACT.radius).div(s.buildingSize).mul(lod.exp2());
  const level = lod.add(CONTACT.lod);
  let around: Node = float(0);
  for (const [x, y] of ring(4)) around = around.add(buildingMeters(at.add(reach.mul(vec2(x, y))), level));
  const depth = around.div(4).sub(meters).div(CONTACT.rangeM).clamp(0, 1);
  return float(1).sub(depth.mul(s.contact).mul(s.buildingGrow).mul(drawn).mul(inside(at)));
}

export function createTerrainMaterial(): MeshStandardNodeMaterial {
  const ground = groundFromScreen(positionGeometry.xz);
  const blockUv = ground.xz.div(s.blockSize).add(0.5);
  const uv = vertexStage(blockUv);
  const material = new MeshStandardNodeMaterial({ roughness: 0.85, metalness: 0 });
  const meters = terrainMeters(blockUv);
  const height = meters.sub(s.floor).mul(s.heightScale);
  const sea = float(1).sub(smoothstep(0, 1, meters));
  material.positionNode = vec3(ground.x, height.sub(sea.mul(SEA_DROP)), ground.z);

  // Pente et creux par sommet : moins nombreux que les pixels, et absents de la passe d'ombre.
  const spread = s.texel.mul(NORMAL_SPREAD);
  const du = vec2(spread.x, 0);
  const dv = vec2(0, spread.y);
  const dx = terrainHeight(blockUv.add(du)).sub(terrainHeight(blockUv.sub(du))).div(spread.x.mul(s.blockSize.x).mul(2));
  const dz = terrainHeight(blockUv.add(dv)).sub(terrainHeight(blockUv.sub(dv))).div(spread.y.mul(s.blockSize.y).mul(2));
  const normal = vertexStage(vec3(dx.negate(), 1, dz.negate()));

  // Creux : pente moyenne vers le haut autour du point, sur deux rayons.
  let concavity: Node = float(0);
  for (const { radius, samples } of [NEAR_RING, FAR_RING]) {
    const offset = s.texel.mul(radius);
    let sum: Node = float(0);
    for (const [cx, cy] of ring(samples)) sum = sum.add(terrainHeight(blockUv.add(vec2(cx, cy).mul(offset)), radius === NEAR_RING.radius));
    concavity = concavity.add(sum.div(samples).sub(height).div(offset.x.mul(s.blockSize.x)));
  }
  const occlusion = vertexStage(float(1).sub(concavity.mul(s.occlusion).clamp(0, 0.85)));

  // Brume : nappes de bruit dans la moitie basse du relief, qui derivent lentement.
  const low = vertexStage(meters.sub(s.floor).div(s.relief.max(1)));
  const lonLat = s.geoOrigin.add(uv.mul(s.geoSize));
  const geo = lonLat.mul(vec2(s.geoCos, 1));
  const noiseAt = (scale: Node) => s.mistNoise.sample(geo.mul(scale).div(NOISE_CELLS).add(s.mistDrift)).r;
  const clouds = mix(noiseAt(s.mistScales.x), noiseAt(s.mistScales.y), s.mistBlend);
  const seaTint = vertexStage(sea);
  // Pas de brume sur une vue plate (une ville) : elle n'aurait pas de creux ou se loger.
  const hilly = smoothstep(80, 600, s.relief);
  const mist = smoothstep(0.45, 0.8, clouds).mul(smoothstep(0, 0.55, low).oneMinus()).mul(seaTint.mul(-0.7).add(1)).mul(s.mist).mul(hilly);

  // Bati : parallaxe (sinon volumes a part) ; ombres, creux et normales la ou un batiment est touche.
  const at = s.buildingOffset.add(uv.mul(s.buildingScale));
  const lod = log2(max(fwidth(at.x), fwidth(at.y)).mul(s.buildingSize.x).max(1)).add(s.lodBias).max(0);
  const drawn = drawnMask(vertexStage(ground.xz));
  const units = s.buildingUnits.mul(drawn);
  const hit = parallaxHit(at, normal, lod, units).toVar();
  const onBuilding = step(0.5, hit.w);
  const surface = mix(at, hit.xy, onBuilding);
  const hitMeters = hit.z;
  const light = parallaxLight(surface, hitMeters, lod, units).toVar();
  // Pentes du bati lues seulement sur un batiment touche.
  const worldNormal = Fn(() => {
    const n = normalize(normal).toVar();
    If(onBuilding.greaterThan(0), () => {
      n.assign(buildingNormal(hit.xy, hit.w.sub(1).max(0), lod));
    });
    return n;
  })();
  material.normalNode = normalize(cameraViewMatrix.mul(vec4(worldNormal, 0)).xyz);
  // @ts-expect-error @types/three type ce rappel sans parametre ; three lui passe l'ombre recue.
  material.receivedShadowNode = Fn(([shadow]: [Node]) => shadow.mul(light));

  const relief = mix(color(0xe4e4e4).mul(occlusion), color(SEA_COLOR), seaTint);
  const cover = landcoverAt(uv);
  const land = mix(drawLandcover(relief, cover, geo, drawn), color(CLAY), onBuilding).mul(contactShade(surface, hitMeters, lod, drawn));
  material.colorNode = mix(land, color(0xf4f4f4), mist);
  // La brume eclaire aussi les versants a l'ombre.
  material.emissiveNode = vec3(mist.mul(0.25));

  // Le sol s'efface vers les bords et au-dela du monde (vue mondiale), apres l'eclairage : vers le noir,
  // ou vers le papier a l'encre ; au carre, pour un fondu regulier a l'oeil malgre le passage en sRGB.
  const inWorld = step(-180, lonLat.x).mul(step(lonLat.x, 180)).mul(step(-90, lonLat.y)).mul(step(lonLat.y, 90));
  const fade = groundFade(uv).mul(inWorld);
  // A l'encre, le relief aussi disparait hors de la zone dessinee : il ne reste que le papier.
  const shown = fade.mul(fade).mul(mix(float(1), drawn, s.pen));
  const lit = mix(vec3(s.pen), output.rgb, shown);

  // Encre directe (parallaxe) : tout le dessin dans cette passe, sans normales ni profondeur a relire.
  // Motifs et papier accroches a la carte : ecart au coin de la vue, petit, donc precis en flottants.
  const toGeo = vec2(s.geoCos, 1);
  const anchor = inkAnchorOf(uv);
  const tone = luminance(output.rgb).max(0).pow(1 / 2.2);
  const far = smoothstep(INK_DISTANCE.near, INK_DISTANCE.far, length(positionWorld.sub(cameraPosition)));
  const wall = hit.w.sub(1).max(0).mul(onBuilding);
  // Murs : traits accroches au mur, le long de sa base.
  const hitCorner = hit.xy.sub(s.buildingOffset).div(s.buildingScale).mul(s.geoSize).mul(toGeo);
  const tangent = vec2(worldNormal.z.negate(), worldNormal.x.negate());
  const along: [Node, Node] = [
    hitCorner.add(s.inkOrigin.xy).dot(tangent).mul(s.inkScale.x),
    hitCorner.add(s.inkOrigin.zw).dot(tangent).mul(s.inkScale.y),
  ];
  const open = onBuilding.oneMinus().mul(drawn);
  const coverage = inkCoverage(tone, anchor, { far, wall, along, vegetation: cover.fill.g.mul(open), water: cover.fill.b.mul(open) });
  // Contours par derivees : silhouettes, sauts de hauteur et aretes, sans relire de voisins.
  const silhouette = fwidth(onBuilding).min(1);
  const jump = smoothstep(0.35, 0.7, fwidth(hitMeters).div(hitMeters.max(4)).mul(3));
  const crease = smoothstep(0.35, 0.7, length(fwidth(worldNormal)).mul(1.5));
  const edges = max(silhouette, max(jump, crease)).mul(drawn);
  const inked = inkOnPaper(max(coverage, edges).mul(shown), anchor, paperAt(anchor, shown.oneMinus()));
  material.outputNode = vec4(mix(lit, inked, s.inkDirect), output.a);
  // Pour l'effet plein ecran : part dessinee du pixel (le reste s'efface dans le papier et le journal).
  material.mrtNode = mrt({ normal: vec4(directionToColor(normalView), shown) });

  return material;
}
