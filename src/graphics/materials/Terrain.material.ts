import {
  DataTexture,
  HalfFloatType,
  LinearFilter,
  Matrix4,
  RedFormat,
  RepeatWrapping,
  RGBAFormat,
  UnsignedByteType,
  Vector2,
  Vector3,
  Vector4,
} from "three";
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
  Loop,
  max,
  mix,
  normalize,
  output,
  positionGeometry,
  positionWorld,
  select,
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
import { inkSettings, type InkAnchor } from "@graphics/postprocessing/effects/InkStyle.ts";
import { PEAK_CELL } from "@graphics/terrain/Buildings.ts";

/** Ecart des echantillons de pente, en texels : au-dela de 1, le modele est adouci. */
const NORMAL_SPREAD = 1.5;
/** Assombrissement des creux : anneau proche lu dans le detail, anneau large dans l'apercu (rayons en texels du detail). */
const NEAR_RING = { radius: 3, samples: 4 };
const FAR_RING = { radius: 12, samples: 8 };
/** Mer : decroche sous la cote, en unites de scene (sa teinte est un reglage, `seaTone`). */
const SEA_DROP = 0.3;
/** Le sol s'efface dans le fond entre ces distances du centre (unites de scene). */
export const GROUND_FADE = { near: 95, far: 150 };
/** Bord du monde : latitude ou les donnees Mercator s'arretent, et largeur du fondu (part de la vue). */
const WORLD_EDGE_LAT = 84;
const WORLD_EDGE_FADE = 0.16;
/** Texture de donnees : encre du bati et de ses contours, eau, vegetation, routes couleur papier. */
const INK = 0x24345c;
const INK_DARK = 0x141c33;
const PAPER = 0xf7f4ec;
/** Force du trait qui cerne les routes. */
const ROAD_EDGE = 0.85;
/** Relief nu, et part d'encre du bati dessine a plat dessus. */
const RELIEF = 0xe4e4e4;
const FLAT_INK = 0.42;
/**
 * Marques du survol ajoutees a l'alpha des normales : une fois `HOVER_BAND` si le pixel est dans le lieu tenu
 * sous la souris, deux fois s'il est sur son perimetre. La part dessinee tient dans 0..1 et les volumes
 * extrudes la passent en negatif, le signe reste donc lisible. `InkEffect` les retranche avant de se servir
 * de la part dessinee.
 */
export const HOVER_BAND = 2;
/** Demi-largeur du trait de perimetre du lieu survole, en pixels d'ecran. */
const RIM_PX = 1.1;
/** Teinte d'un batiment a plat sur le sol : un volume qui commence a monter la prend, et se confond avec lui. */
export const FLAT_BUILDING = mix(color(RELIEF), color(INK), FLAT_INK);
/** Hachures par cellule de bruit de brume (3 a 6 cellules sur la largeur de la vue). */
const HATCHES_PER_CELL = 30;
/** Trait de cote : rayon (texels du relief) et points de l'anneau qui lissent le bord. */
const SHORE_TEXELS = 2;
const SHORE_SAMPLES = 6;
/** Large : points par anneau (deux anneaux) qui donnent la distance au rivage. */
const DEPTH_SAMPLES = 4;
/** Eau : cellules de bruit par cellule de brume, pour l'ondulation lente et pour le tremble du bord. */
const WAVE_CELLS = 3;
const SURF_CELLS = 14;
/** Cellules de bruit sur une repetition de la texture de brume. */
const NOISE_CELLS = 8;
/** Bati en relief, facon maquette d'argile. */
export const CLAY = 0xece8e1;
/** Marche dans la texture de hauteurs : bornes des boucles (les pas reels sont des reglages, voir `terrainSettings`). */
const MAX_COARSE_STEPS = 48;
const MAX_FINE_STEPS = 96;
/** Largeur du bord des ombres du bati (m) par unite de `shadowSoftness`. */
const SHADOW_SOFT_M = 25;
/** Dichotomies apres l'impact : la position du mur a 1/8 de pas pres. */
const REFINE_STEPS = 3;
/** Volumes extrudes : pas de la marche fine repris autour d'eux (voir `buildingSurface`). */
const SURFACE_STEPS = 4;
/** Bruit du bord du masque : cellules de bruit par cellule de brume, accroche a la carte (sans derive : il ne bouge pas). */
const MASK_FREQUENCY = 2;
/** Taches du dessin qui apparait (`pencilReveal`) : cellules de bruit par cellule de brume, et largeur du bord. */
const REVEAL_FREQUENCY = 5;
const REVEAL_EDGE = 0.05;
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
  /**
   * Partie de l'ecran couverte par la grille du sol (x0, y0, x1, y1, de 0 a 1, y vers le haut) : a l'encre, le
   * rectangle ou se projette la zone dessinee ; hors de lui, le sol n'est que papier, rien n'y est calcule.
   */
  screenRect: uniform(new Vector4(0, 0, 1, 1)),
  /**
   * Lieu survole : son contour rasterise (`AreaMaskHelper`) et le cadre en degres ou il se pose
   * (ouest, nord, etendue en longitude, etendue en latitude, negative). Etendue nulle : rien n'est survole.
   */
  hoverArea: texture(new DataTexture(new Uint8Array(4), 1, 1, RGBAFormat, UnsignedByteType)),
  hoverBounds: uniform(new Vector4(0, 0, 0, 0)),
  /** Part gagnee par le rouge sur le territoire survole : il monte et reflue par taches, pas d'un bloc. */
  hoverReveal: uniform(0),
  /** Taille des taches par lesquelles le rouge gagne, en unites de `geo`. */
  hoverGrain: uniform(0.35),
  /** Textures de donnees (R bati, G vegetation, B eau ; routes en R) et leur cadrage en uv du bloc. */
  landcover: texture(new DataTexture(new Uint8Array(4), 1, 1, RGBAFormat, UnsignedByteType)),
  landcoverRoads: texture(new DataTexture(new Uint8Array(4), 1, 1, RGBAFormat, UnsignedByteType)),
  landcoverOffset: uniform(new Vector2()),
  landcoverScale: uniform(new Vector2(1, 1)),
  /** Image precedente et son cadrage ; la nouvelle s'y dessine par taches de 0 a 1 (`landcoverReveal`). */
  landcoverPrevious: texture(new DataTexture(new Uint8Array(4), 1, 1, RGBAFormat, UnsignedByteType)),
  landcoverRoadsPrevious: texture(new DataTexture(new Uint8Array(4), 1, 1, RGBAFormat, UnsignedByteType)),
  landcoverPreviousOffset: uniform(new Vector2()),
  landcoverPreviousScale: uniform(new Vector2(1, 1)),
  landcoverReveal: uniform(1),
  landcoverStrength: uniform(1),
  /** Hauteurs du bati (m) sur la zone fine, leur cadrage en uv du bloc, taille en texels, plus grande hauteur (m). */
  buildingHeights: texture(new DataTexture(new Uint8Array(1), 1, 1, RedFormat, UnsignedByteType)),
  buildingOffset: uniform(new Vector2()),
  buildingScale: uniform(new Vector2(1, 1)),
  buildingSize: uniform(new Vector2(1, 1)),
  buildingMax: uniform(0),
  /** Sommets par cellule de `PEAK_CELL` texels, etendus aux voisines : la ou la marche peut s'arreter. */
  buildingPeaks: texture(new DataTexture(new Uint8Array(1), 1, 1, RedFormat, UnsignedByteType)),
  /** Ombre du bati : hauteur (m) sous laquelle un point est a l'ombre (voir `sunShadow`), sur la meme zone. */
  buildingShade: texture(new DataTexture(new Uint8Array(1), 1, 1, RedFormat, UnsignedByteType)),
  /** Sommets des environs (cellules de `SUMMIT_CELL` texels) : la marche part de la, pas du plus haut batiment de la zone. */
  buildingSummits: texture(new DataTexture(new Uint8Array(1), 1, 1, RedFormat, UnsignedByteType)),
  /** Unites de scene par metre de bati (0 : pas de bati), et apparition de 0 a 1. */
  buildingUnits: uniform(0),
  buildingGrow: uniform(0),
  /** Direction du soleil, vers lui. */
  sun: uniform(new Vector3(0, 1, 0)),
  /**
   * Zone dessinee (voir `TERRAIN_CONFIG.mask`) : ellipse sur la carte, centree sur le point vise (l'origine de la
   * scene, ou la camera orbite), dans les axes de la vue : `maskAxis`, direction du regard au sol (unitaire), prise
   * sur la rotation de la vue et non sur la camera ; largeur en travers, profondeur le long.
   */
  maskAxis: uniform(new Vector2(0, -1)),
  maskRadius: uniform(new Vector2(...M.radius)),
  /** Agrandissement de la zone en vue large (`TERRAIN_CONFIG.mask.widen`). */
  maskScale: uniform(1),
  /** Ouverture de la zone dessinee a l'arrivee (0 : page blanche, 1 : carte entiere) : voir l'intro. */
  drawnReveal: uniform(1),
  /** Simplification au loin : hauteur (m) sous laquelle un batiment lointain n'est plus dessine, au plus. */
  simplify: uniform(10),
  /** Secondes ecoulees : vent dans les arbres, houle des traits de l'eau. */
  clock: uniform(0),
  /** Vent dans les arbres (0 : arbres raides). */
  wind: uniform(1),
  /**
   * Eau dessinee a la plume : ton de la mer sous les traits (1 : papier nu), force et epaisseur du trait,
   * traits par cellule de bruit. Lignes a 45 degres qui ondulent (`waterWave`) et s'espacent en s'enfoncant
   * dans l'eau, sur `waterReach` (part du bloc) depuis le bord ; pres de la rive elles tremblent (`waterSurf`).
   */
  seaTone: uniform(0.97),
  waterInk: uniform(1),
  waterWidth: uniform(0.05),
  waterLines: uniform(30),
  waterReach: uniform(0.22),
  waterWave: uniform(0.5),
  waterSurf: uniform(0.7),
  maskSoftness: uniform(M.softness as number),
  maskJitter: uniform(M.jitter as number),
  /** Dessin a l'encre (0 ou 1) : hachures a la plume du bati, sol qui s'efface vers le papier (blanc) plutot que vers le noir. */
  pen: uniform(0),
  /**
   * Motifs d'encre accroches a la carte, a deux echelles (celles de la brume) : pseudo-pixels par unite
   * de `geo`, et ecart (en `geo`) entre le coin de la vue et une origine recalee d'une periode entiere
   * (`INK_PERIOD`), calcule en double precision cote CPU.
   */
  inkScale: uniform(new Vector2(1, 1)),
  inkOrigin: uniform(new Vector4()),
  /**
   * Marche dans la texture de hauteurs (voir `buildingSurface`), de quoi arbitrer qualite et cout : pas par cellule
   * de sommets et pas fins (au plus), texels par pas fin, penombre par metre, decalage du niveau de mip
   * (plus haut : moins de lectures fines, bords plus doux), force du creux au pied du bati.
   */
  coarseSteps: uniform(24),
  fineSteps: uniform(24),
  stepTexels: uniform(2),
  shadowSoftness: uniform(0.12),
  lodBias: uniform(0),
  contact: uniform(0.45),
};

const s = terrainSettings;
const read = (map: TextureNode, uv: Node) => (map.sample(uv) as TextureNode).level(float(0)).r;
// Hors de la mosaique du detail (en vol, elle suit avec retard), seul l'apercu compte.
const inside = (uv: Node) => step(0, uv.x).mul(step(uv.x, 1)).mul(step(0, uv.y)).mul(step(uv.y, 1));

/** Coordonnees geographiques (longitude x cosinus, latitude) du point `xz` de la scene. */
export const geoAt = (xz: Node) => s.geoOrigin.add(xz.div(s.blockSize).add(0.5).mul(s.geoSize)).mul(vec2(s.geoCos, 1));

/**
 * Dessin qui apparait au crayon, par taches accrochees a la carte : 0 quand `progress` vaut 0, 1 quand il vaut 1,
 * et entre les deux une tache apres l'autre selon un bruit (comme les revelations de Chartogne-Taillet).
 */
export function pencilReveal(geo: Node, progress: Node): Node {
  const noise = revealNoise(geo);
  return smoothstep(noise.sub(REVEAL_EDGE), noise.add(REVEAL_EDGE), progress.mul(1.3).sub(0.15));
}

/** Bruit des taches de `pencilReveal` au point `geo` (0 a 1, moyenne 0,5) : ordre d'apparition. */
export function revealNoise(geo: Node): Node {
  const at = (scale: Node) => read(s.mistNoise, geo.mul(scale).mul(REVEAL_FREQUENCY / NOISE_CELLS));
  return mix(at(s.mistScales.x), at(s.mistScales.y), s.mistBlend);
}

/**
 * 1 dans la zone dessinee, 0 au-dela, au point `xz` de la scene : ellipse posee sur la carte autour du point vise,
 * dans les axes de la vue, bord fondu et irregulier (bruit accroche a la carte). Lisible aussi dans le vertex shader.
 */
export function drawnMask(xz: Node): Node {
  const local = vec2(xz.x.mul(s.maskAxis.y).sub(xz.y.mul(s.maskAxis.x)), xz.dot(s.maskAxis));
  const distance = length(local.div(s.maskRadius.mul(s.maskScale).mul(s.drawnReveal.max(1e-3))));
  const geo = geoAt(xz);
  const at = (scale: Node) => read(s.mistNoise, geo.mul(scale).mul(MASK_FREQUENCY / NOISE_CELLS));
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
  const h1 = i
    .add(1.5)
    .add(w3.div(g1.max(1e-4)))
    .div(size);
  const row = (y: Node) =>
    read(map, vec2(h0.x, y))
      .mul(g0.x)
      .add(read(map, vec2(h1.x, y)).mul(g1.x));
  return row(h0.y).mul(g0.y).add(row(h1.y).mul(g1.y));
}

function coarseAt(blockUv: Node, smooth: boolean): Node {
  const uv = s.coarseOffset.add(blockUv.mul(s.coarseScale));
  return smooth ? smoothRead(s.coarseHeights, uv, s.coarseSize) : read(s.coarseHeights, uv);
}

/**
 * Altitude (m) au point `blockUv` du bloc, a lire dans le vertex shader. `detailed` a faux : apercu brut, moins cher ;
 * `smooth` a faux : apercu sans B-spline (1 lecture au lieu de 4), la ou le detail couvre.
 * Le filtrage melange altitudes et zeros des trous : divise par la part de donnees, il redonne la moyenne des texels valides.
 * Mer a 0 : sans quoi le fond marin fixerait le plancher de la vue, et la camera y plongerait.
 */
export function terrainMeters(blockUv: Node, detailed = true, smooth = detailed): Node {
  const coarse = coarseAt(blockUv, smooth);
  if (!detailed) return coarse.max(0);
  const uv = s.uvOffset.add(blockUv.mul(s.uvScale));
  const weight = read(s.valid, uv).mul(inside(uv));
  return mix(coarse, read(s.heights, uv).div(weight.max(1e-3)), weight).max(0);
}

/** 1 au centre du sol, 0 au-dela de `GROUND_FADE.far`, pour un point `blockUv` du bloc. `smoothstep` veut ses bornes dans l'ordre (Metal). */
export function groundFade(blockUv: Node): Node {
  return smoothstep(GROUND_FADE.near, GROUND_FADE.far, length(blockUv.sub(0.5).mul(s.blockSize))).oneMinus();
}

/** Hauteur dans la scene au point `blockUv` du bloc (vertex shader). */
export function terrainHeight(blockUv: Node, detailed = true, smooth = detailed): Node {
  return terrainMeters(blockUv, detailed, smooth).sub(s.floor).mul(s.heightScale);
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

/** Traits a la plume accroches au sol, le long de `along` (degres, longitude x cosinus) ; deux echelles fondues pendant le zoom. */
export function penLines(along: Node, width: Node | number = 0.12): Node {
  const at = (scale: Node) => hatch(along.mul(scale).mul(HATCHES_PER_CELL), width);
  return mix(at(s.mistScales.x), at(s.mistScales.y), s.mistBlend);
}

/**
 * Part de terre autour du point `blockUv`, moyennee sur un anneau de rayon `radius` (part du bloc). Lue dans
 * l'apercu du relief : elle couvre toute la vue, et un texel isole n'y fait pas une ile.
 */
function landAround(blockUv: Node, radius: Node | number, samples: number): Node {
  const r = typeof radius === "number" ? float(radius) : radius;
  let sum: Node = float(0);
  for (const [x, y] of ring(samples)) sum = sum.add(step(0.5, terrainMeters(blockUv.add(vec2(x, y).mul(r)), false)));
  return sum.div(samples);
}

/**
 * Rivage et large au point `blockUv`. `land` : part de terre tout pres (0 en mer, 1 a terre), qui passe de l'une
 * a l'autre en une largeur constante au lieu de suivre les bords des texels du relief — sans elle, le trait de
 * cote monte en escalier, et une grille plus fine n'y change rien (mesure du 2026-09-20).
 * `depth` : 0 au rivage, 2 au large, par deux anneaux de plus en plus larges ; elle espace les traits de l'eau.
 */
function shoreAt(blockUv: Node): { land: Node; depth: Node } {
  const near = s.texel.x.mul(SHORE_TEXELS);
  const land = mix(step(0.5, terrainMeters(blockUv, false)), landAround(blockUv, near, SHORE_SAMPLES), 0.8).toVar();
  // Les anneaux larges ne servent qu'a l'eau : en pleine terre (une ville), ils ne sont pas lus.
  const depth = Fn(() => {
    const value = float(0).toVar();
    If(land.lessThan(0.99), () => {
      value.assign(
        landAround(blockUv, s.waterReach.mul(0.35), DEPTH_SAMPLES)
          .oneMinus()
          .add(landAround(blockUv, s.waterReach, DEPTH_SAMPLES).oneMinus()),
      );
    });
    return value;
  })();
  return { land, depth };
}

/**
 * Traits de l'eau : des lignes a 45 degres accrochees a la carte, qui ondulent lentement (`waterWave`). Plus
 * l'eau est profonde (`depth`, 0 au bord, 2 au milieu), plus elles sont espacees : a chaque palier un trait sur
 * deux disparait, et les traits gardes ne bougent pas. Pres de la rive, le trait tremble et son epaisseur varie
 * (`waterSurf`) : vagues et courants, dessines au crayon.
 * Le lissage du trait (`aa`, un pixel en unites de `geo`) est passe : le motif n'est calcule que sur l'eau, et
 * une derivee n'a pas de sens dans une branche que tous les pixels ne prennent pas.
 */
function seaLines(geo: Node, depth: Node, aa: Node): Node {
  // 1 au bord de l'eau, 0 au milieu : c'est la que la mer s'agite.
  const surf = depth.mul(0.5).oneMinus().clamp(0, 1).mul(s.waterSurf);
  const at = (scale: Node) => {
    const p = geo.mul(scale);
    const noise = (cells: number, shift: number) => read(s.mistNoise, p.mul(cells / NOISE_CELLS).add(shift)).sub(0.5);
    const wave = noise(WAVE_CELLS, 0).mul(s.waterWave);
    const jitter = noise(SURF_CELLS, 0.37).mul(surf);
    const along = p.x.add(p.y).mul(s.waterLines).add(wave).add(jitter);
    // Trait plus gras, plus maigre, comme un crayon : seulement pres de la rive.
    const width = s.waterWidth.mul(noise(SURF_CELLS, 0.71).mul(surf).add(1)).max(0.01);
    const soft = aa.mul(scale).mul(s.waterLines);
    const level = (halvings: number) => {
      const shrink = 2 ** -halvings;
      const distance = abs(along.mul(shrink).add(0.5).fract().sub(0.5));
      return smoothstep(width, soft.mul(shrink).add(width), distance).oneMinus();
    };
    return mix(mix(level(0), level(1), depth.clamp(0, 1)), level(2), depth.sub(1).clamp(0, 1));
  };
  return mix(at(s.mistScales.x), at(s.mistScales.y), s.mistBlend);
}

/**
 * Dessine la texture de donnees sur le relief, facon carte imprimee : vegetation hachuree, eau en traits
 * horizontaux, routes en reserve de papier, bati a l'encre bleue cerne plus fonce.
 * Hachures accrochees au sol, fondues entre deux echelles pendant le zoom (comme la brume).
 */
/**
 * Texture de donnees au point `blockUv` : aplats (bords nets a toute echelle) et contours, par canal. Une nouvelle
 * image se fond dans la precedente (changement de zoom compris), plutot que de la remplacer d'un coup.
 */
function landcoverAt(blockUv: Node): { fill: Node; outline: Node } {
  const cover = (areas: TextureNode, roads: TextureNode, offset: Node, scale: Node) => {
    const at = offset.add(blockUv.mul(scale));
    return vec4(areas.sample(at).rgb, roads.sample(at).r).mul(inside(at));
  };
  // Fondu d'une image a l'autre : les contours glissent de l'une a l'autre au lieu d'etre remplaces par taches.
  // L'ancienne n'est lue que pendant le fondu (branche uniforme).
  const data = Fn(() => {
    const now = cover(s.landcover, s.landcoverRoads, s.landcoverOffset, s.landcoverScale).toVar();
    If(s.landcoverReveal.lessThan(1), () => {
      const before = cover(s.landcoverPrevious, s.landcoverRoadsPrevious, s.landcoverPreviousOffset, s.landcoverPreviousScale);
      now.assign(mix(before, now, smoothstep(0, 1, s.landcoverReveal)));
    });
    return now;
  })();
  const edge = fwidth(data).max(1e-3);
  return {
    fill: smoothstep(edge.negate().add(0.5), edge.add(0.5), data),
    outline: smoothstep(vec4(0), edge.mul(1.5), abs(data.sub(0.5))).oneMinus(),
  };
}

/** Eau du point : rivieres et lacs du plan, plus la mer (`sea`), et le trait de cote qui les cerne. */
interface Water {
  wet: Node;
  depth: Node;
  coast: Node;
  /** Un pixel en unites de `geo` : lisse le trait, et se lit hors de la branche qui dessine l'eau. */
  pixel: Node;
}

function drawLandcover(
  relief: Node,
  { fill, outline }: { fill: Node; outline: Node },
  geo: Node,
  drawn: Node,
  water: Water,
): Node {
  const diagonal = penLines(geo.x.add(geo.y));

  // Les hachures de vegetation sont du remplissage : c'est la premiere chose qu'un dessin epure laisse tomber.
  let paper: Node = mix(relief, color(0xcfd5e2), fill.g.mul(0.35));
  paper = mix(paper, color(INK), fill.g.mul(diagonal).mul(inkSettings.detail.mul(0.45)));
  // Eau : du papier presque nu, parcouru de traits paralleles qui s'espacent vers le large.
  const wet = max(fill.b, water.wet);
  paper = mix(paper, vec3(s.seaTone), wet);
  // Le motif de l'eau ne se calcule que sur l'eau : ailleurs il ne couterait rien d'autre que du temps.
  const lines = Fn(() => {
    const drawn = float(0).toVar();
    If(wet.greaterThan(0.001), () => {
      drawn.assign(seaLines(geo, water.depth, water.pixel));
    });
    return drawn;
  })();
  // Trait franc (l'encre la plus sombre) : un trait a demi teinte se ferait hachurer a 45 degres par la passe
  // d'encre au lieu de rester un trait.
  paper = mix(paper, color(INK_DARK), wet.mul(lines).mul(s.waterInk));
  paper = mix(paper, color(INK_DARK), max(outline.b, water.coast).mul(0.9));
  paper = mix(paper, color(PAPER), fill.a.mul(0.85));
  // Routes en reserve de papier, cernees d'un trait comme sur une carte gravee.
  paper = mix(paper, color(INK_DARK), outline.a.mul(ROAD_EDGE));
  // Le bati reste dessine a plat sous les volumes : il en tient lieu tant qu'ils ne sont pas arrives, et
  // ceux-ci partent de lui (`FLAT_BUILDING`).
  paper = mix(paper, color(INK), fill.r.mul(FLAT_INK));
  paper = mix(paper, color(INK_DARK), outline.r.mul(0.85));
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
const buildingsNear = (at: Node, units: Node) => units.mul(s.buildingMax).mul(inside(at)).greaterThan(0);

/**
 * Debut de la marche fine, en unites parcourues depuis le sol vers la camera (0 : aucun batiment a toucher) :
 * depart a hauteur du plus haut sommet des environs (dans une ville de 20 m, pas de marche depuis 255 m),
 * puis une cellule de sommets par pas, jusqu'a la premiere qui peut arreter le rayon.
 */
const marchEntry = Fn(([at, perUnit, climb, texelsPerUnit]: [Node, Node, Node, Node]) => {
  const top = summitMeters(at).div(climb);
  const cell = float(PEAK_CELL).div(texelsPerUnit).max(top.div(s.coarseSteps));
  const entry = float(0).toVar();
  Loop(MAX_COARSE_STEPS, ({ i }) => {
    const distance = top.sub(cell.mul(float(i)));
    If(distance.lessThanEqual(0).or(float(i).greaterThanEqual(s.coarseSteps)), () => {
      Break();
    });
    // Bas du pas sous le sommet de la cellule : un batiment peut arreter le rayon ici.
    If(
      distance
        .sub(cell)
        .max(0)
        .mul(climb)
        .lessThan(peakMeters(at.sub(perUnit.mul(distance)))),
      () => {
        entry.assign(distance);
        Break();
      },
    );
  });
  return entry;
});

/** Pas fins d'une marche entamee a `entry` : `stepTexels` texels du niveau de mip lu (loin, moins de pas). */
function fineSteps(entry: Node, texelsPerUnit: Node, lod: Node): { steps: Node; spacing: Node } {
  const steps = entry.mul(texelsPerUnit).div(lod.exp2().mul(s.stepTexels)).ceil().clamp(1, s.fineSteps);
  return { steps, spacing: entry.div(steps) };
}

/**
 * Marche fine d'`entry` vers le sol en `steps` pas, depuis le pas `from` et pour `count` pas au plus : le premier
 * batiment traverse, position affinee par dichotomie. Rend (uv du point touche, hauteur en m, 0 si rien, sinon
 * 1 + part de mur).
 */
const fineMarch = Fn(([at, perUnit, climb, lod, entry, steps, from, count]: [Node, Node, Node, Node, Node, Node, Node, Node]) => {
  const hit = vec4(0).toVar();
  const metersAt = (distance: Node) => buildingMeters(at.sub(perUnit.mul(distance)), lod);
  const spacing = entry.div(steps);
  // Avant le premier pas de la marche, rien : elle part d'au-dessus de tout.
  const lastHeight = select(from.greaterThan(0), metersAt(entry.mul(from.sub(1).div(steps).oneMinus())), float(0)).toVar();
  Loop({ start: int(0), end: int(MAX_FINE_STEPS), condition: "<=" }, ({ i }) => {
    const index = from.add(float(i));
    If(index.greaterThan(steps).or(float(i).greaterThanEqual(count)), () => {
      Break();
    });
    // Dernier pas exactement sur le sol : un arrondi l'y ferait passer dessous.
    const distance = entry.mul(index.div(steps).oneMinus());
    const height = metersAt(distance);
    const gap = climb.mul(distance).sub(height);
    // Nettement sous un toit : le sol lui-meme n'est pas un batiment.
    If(gap.lessThan(-0.05), () => {
      // Dichotomie entre le dernier point au-dessus et le premier dessous : des pas plus grands suffisent.
      const above = distance.add(spacing).min(entry).toVar();
      const below = distance.toVar();
      for (let r = 0; r < REFINE_STEPS; r++) {
        const middle = above.add(below).mul(0.5);
        If(climb.mul(middle).sub(metersAt(middle)).lessThan(-0.05), () => {
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
 * Part de soleil au point `at`, a `meters` au-dessus du sol : l'ombre du bati est cuite par le worker (`sunShadow`,
 * hauteur sous laquelle on est a l'ombre), une lecture au lieu d'une marche vers le soleil a chaque pixel.
 * Bord adouci sur `shadowSoftness` x `SHADOW_SOFT_M` metres ; sans bati en relief (`units` nul), plein soleil.
 */
function sunLight(at: Node, meters: Node, lod: Node, units: Node): Node {
  const shade = (s.buildingShade.sample(at) as TextureNode).level(lod).r.mul(255);
  // Au-dessus de la hauteur d'ombre : plein soleil ; en dessous, l'ombre se fonce sur la largeur du bord.
  const lit = smoothstep(s.shadowSoftness.mul(SHADOW_SOFT_M).max(0.5).negate(), 0, meters.sub(shade));
  return mix(float(1), lit, buildingsNear(at, units).select(float(1), float(0)));
}

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

const toBuildings = (xz: Node) => s.buildingOffset.add(xz.div(s.blockSize).add(0.5).mul(s.buildingScale));

/**
 * Ce que la texture de hauteurs porte au point `position` d'un volume extrude pose a `base` : le volume ne fait que
 * couvrir les pixels, l'impact, la normale, le soleil et le creux sont les siens, lus dans la meme texture de
 * hauteurs (contours rugueux et grain des murs compris). Meme marche, reprise un pas au-dessus du volume pour
 * `SURFACE_STEPS` pas : la texture et le volume different de moins d'un pas ; seule la descente jusqu'a lui est
 * epargnee. Tant que la texture n'a pas ce batiment (elle arrive apres les volumes), ce sont les faces du volume
 * (`facing`), sans ombre ni creux : les contours sont la des l'apparition. `raster` (0 a 1) : part de la texture.
 */
export function buildingSurface(
  position: Node,
  base: Node,
  rise: Node,
  facing: Node,
  raster: Node,
): { normal: Node; light: Node; shade: Node } {
  const dir = normalize(position.sub(cameraPosition));
  // Point du sol vise : la marche regle son niveau de mip et ses pas depuis lui.
  const ground = cameraPosition.xz.add(dir.xz.mul(cameraPosition.y.sub(base).div(dir.y.negate().max(1e-4))));
  const onGround = toBuildings(ground);
  const lod = log2(max(fwidth(onGround.x), fwidth(onGround.y)).mul(s.buildingSize.x).max(1))
    .add(s.lodBias)
    .max(0);
  // Volume encore en train de monter (`rise` < 1) : la texture est lue a la meme hauteur que lui. Le masque n'y
  // joue plus : il ne fait qu'effacer, et les aretes ne bougent pas quand la vue bouge.
  const units = s.buildingUnits.mul(rise);
  const perUnit = dir.xz.div(s.blockSize).mul(s.buildingScale);
  const texelsPerUnit = length(perUnit.mul(s.buildingSize)).max(1e-6);
  const climb = dir.y.negate().max(0.05).div(units.max(1e-6));
  const reach = length(position.sub(vec3(ground.x, base, ground.y)));
  // Sommets manquants (hors de la texture) : depart juste au-dessus du volume.
  const entry = marchEntry(onGround, perUnit, climb, texelsPerUnit).max(reach);
  const { steps, spacing } = fineSteps(entry, texelsPerUnit, lod);
  const from = steps.sub(reach.div(spacing)).floor().sub(1).max(0);
  const found = fineMarch(onGround, perUnit, climb, lod, entry, steps, from, float(SURFACE_STEPS)).toVar();
  const inRaster = found.w.greaterThan(0.5);
  // Rien pres du volume (texture et volume en desaccord) : un toit, la ou il est.
  const hit = select(inRaster, found, vec4(onGround.sub(perUnit.mul(reach)), climb.mul(reach), 1));
  const wall = hit.w.sub(1).max(0);
  const share = select(inRaster, raster, float(0));
  return {
    normal: normalize(mix(facing, buildingNormal(hit.xy, wall, lod), share)),
    light: mix(float(1), sunLight(hit.xy, hit.z, lod, units), share),
    shade: mix(float(1), contactShade(hit.xy, hit.z, lod, float(1)), share),
  };
}

export function createTerrainMaterial(): MeshStandardNodeMaterial {
  const ground = groundFromScreen(s.screenRect.xy.add(positionGeometry.xz.mul(s.screenRect.zw.sub(s.screenRect.xy))));
  const blockUv = ground.xz.div(s.blockSize).add(0.5);
  const uv = vertexStage(blockUv);
  const material = new MeshStandardNodeMaterial({
    roughness: 0.85,
    metalness: 0,
  });
  const meters = terrainMeters(blockUv);
  const height = meters.sub(s.floor).mul(s.heightScale);
  const shore = shoreAt(blockUv);
  const sea = smoothstep(0.35, 0.65, shore.land).oneMinus();
  material.positionNode = vec3(ground.x, height.sub(sea.mul(SEA_DROP)), ground.z);

  // Pente et creux par sommet : moins nombreux que les pixels, et absents de la passe d'ombre.
  const spread = s.texel.mul(NORMAL_SPREAD);
  const du = vec2(spread.x, 0);
  const dv = vec2(0, spread.y);
  const dx = terrainHeight(blockUv.add(du))
    .sub(terrainHeight(blockUv.sub(du)))
    .div(spread.x.mul(s.blockSize.x).mul(2));
  const dz = terrainHeight(blockUv.add(dv))
    .sub(terrainHeight(blockUv.sub(dv)))
    .div(spread.y.mul(s.blockSize.y).mul(2));
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
  // Bord de mer : le trait de cote, et la distance au rivage qui espace les traits de l'eau.
  const water: Water = {
    wet: seaTint,
    pixel: fwidth(geo.x.add(geo.y)),
    depth: vertexStage(shore.depth),
    coast: smoothstep(0.3, 0.5, vertexStage(shore.land)).mul(smoothstep(0.7, 0.5, vertexStage(shore.land))),
  };
  // Pas de brume sur une vue plate (une ville) : elle n'aurait pas de creux ou se loger.
  const hilly = smoothstep(80, 600, s.relief);
  const mist = smoothstep(0.45, 0.8, clouds)
    .mul(smoothstep(0, 0.55, low).oneMinus())
    .mul(seaTint.mul(-0.7).add(1))
    .mul(s.mist)
    .mul(hilly);

  // Le sol recoit l'ombre portee du bati (cuite dans la texture de hauteurs) : les volumes sont dessines a part.
  const at = s.buildingOffset.add(uv.mul(s.buildingScale));
  const lod = log2(max(fwidth(at.x), fwidth(at.y)).mul(s.buildingSize.x).max(1))
    .add(s.lodBias)
    .max(0);
  const drawn = vertexStage(drawnMask(ground.xz));
  const units = s.buildingUnits.mul(step(1e-3, drawn));
  const light = sunLight(at, float(0), lod, units).toVar();
  const worldNormal = normalize(normal);
  material.normalNode = normalize(cameraViewMatrix.mul(vec4(worldNormal, 0)).xyz);
  // @ts-expect-error @types/three type ce rappel sans parametre ; three lui passe l'ombre recue.
  material.receivedShadowNode = Fn(([shadow]: [Node]) => shadow.mul(light));

  // Le sol s'efface vers les bords et au-dela du monde (vue mondiale), apres l'eclairage : vers le noir,
  // ou vers le papier a l'encre ; au carre, pour un fondu regulier a l'oeil malgre le passage en sRGB.
  // Bord du monde : un fondu large (part de la vue), jamais une coupure nette — on ne doit pas voir ou la carte
  // s'arrete. Les donnees Mercator s'arretent vers 85 degres.
  const edge = s.geoSize.mul(WORLD_EDGE_FADE).max(0.02);
  const within = (value: Node, limit: number) =>
    smoothstep(float(-limit), float(-limit).add(edge.y), value).mul(smoothstep(float(limit), float(limit).sub(edge.y), value));
  const inWorld = smoothstep(float(-180), float(-180).add(edge.x), lonLat.x)
    .mul(smoothstep(float(180), float(180).sub(edge.x), lonLat.x))
    .mul(within(lonLat.y, WORLD_EDGE_LAT));
  const fade = groundFade(uv).mul(inWorld);
  // A l'encre, le relief aussi disparait hors de la zone dessinee : il ne reste que le papier.
  const shown = fade
    .mul(fade)
    .mul(mix(float(1), drawn, s.pen))
    .toVar();

  // La mer ne porte plus de gris : elle est du papier, et ce sont ses traits qui la disent.
  const relief = mix(color(RELIEF).mul(occlusion), vec3(s.seaTone), seaTint);
  material.colorNode = mix(relief.mul(contactShade(at, float(0), lod, drawn)), color(0xf4f4f4), mist);
  // La brume eclaire aussi les versants a l'ombre.
  material.emissiveNode = vec3(mist.mul(0.25));
  // Plan (eau, bois, routes) imprime sur le relief eclaire, pas eclaire avec lui : un soleil fort le blanchissait
  // jusqu'a l'effacer. Le relief est ramene sous le blanc avant, sinon l'impression y reste invisible.
  const cover = landcoverAt(uv);
  const print = mix(drawLandcover(vec3(1), cover, geo, drawn, water), vec3(1), mist);
  const printed = output.rgb.min(vec3(1)).mul(print);
  // Sortie explicite : le dessin lui-meme est fait par l'effet plein ecran (`InkEffect`).
  material.outputNode = vec4(mix(vec3(s.pen), printed, shown), output.a);
  // Pour l'effet plein ecran : part dessinee du pixel (le reste s'efface dans le papier et le journal), et le
  // lieu survole marque en plus (`HOVER_BAND`), pour que l'encre le colorie sans autre tampon.
  const areaUv = lonLat.sub(s.hoverBounds.xy).div(s.hoverBounds.zw);
  // Champ de distance du contour : 0,5 sur la limite, plus haut dedans (`AreaMaskHelper`).
  const field = read(s.hoverArea, areaUv);
  const onMap = step(0.0001, abs(s.hoverBounds.z)).mul(inside(areaUv));
  // Le rouge monte par taches : un bruit accroche a la carte dit dans quel ordre les pixels basculent, et
  // `hoverReveal` monte de 0 a 1. Un seuil sur ce bruit, jamais un fondu : le trait reste franc.
  const grain = read(s.mistNoise, geo.div(s.hoverGrain.max(0.01)));
  const arrived = step(grain.mul(0.85).add(0.075), s.hoverReveal);
  const insideArea = onMap.mul(step(0.5, field)).mul(arrived);
  // Trait de perimetre d'une largeur constante a l'ecran : la derivee du champ dit ce que vaut un pixel.
  // Il s'arrete a la cote, ou le trait de rivage dit deja la limite ; efface un peu au large, sinon il en
  // resterait la moitie a terre.
  const dry = smoothstep(0.35, 0.05, max(cover.fill.b, water.wet));
  const rim = onMap.mul(step(abs(field.sub(0.5)), fwidth(field).mul(RIM_PX))).mul(dry).mul(arrived);
  material.mrtNode = mrt({ normal: vec4(directionToColor(normalView), shown.add(insideArea.add(rim).mul(HOVER_BAND))) });

  return material;
}
