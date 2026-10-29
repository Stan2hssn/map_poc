import {
  atan,
  float,
  Fn,
  fract,
  fwidth,
  If,
  length,
  luminance,
  max,
  min,
  mix,
  screenCoordinate,
  screenSize,
  smoothstep,
  step,
  uniform,
  vec2,
} from "three/tsl";
import type { Node } from "three/webgpu";
import { noiseAt } from "@graphics/materials/NoiseMap.ts";
import { inkCoverage, inkOnPaper, inkSettings } from "./InkStyle.ts";

/**
 * Passage de la page d'entree a la carte : un masque de composition pose a l'ecran, qui decouvre la carte deja
 * dessinee sous la page. Il ne doit rien au masque de la carte — celui-ci ne s'anime jamais.
 *
 * L'ordre dans lequel les pixels basculent dessine des coups de pinceau qui tournent depuis le centre, comme
 * les transitions de summer-afternoon : quelques bras en spirale, chacun decouvert du centre vers l'exterieur et
 * un peu apres le precedent, des fibres etirees le long du trait et de larges taches qui cassent la regularite.
 * Un seuil sur cet ordre, lisse sur un pixel : le bord est franc, jamais flou. Tout se regle dans la timeline
 * de SONDE (theatre `intro`), le progres comme la forme.
 */
export const pageTransition = {
  /** 0 : la page couvre tout ; 1 : la carte est entierement decouverte. */
  progress: uniform(0),
  /** Bras de la spirale, le tour qu'ils font du centre au coin de l'ecran, et la rotation de l'ensemble (tours). */
  arms: uniform(3),
  twist: uniform(1.35),
  rotation: uniform(0),
  /** Poids de la distance au centre, et retard d'un bras sur le precedent : ce qui fait les coups de pinceau. */
  radius: uniform(0.6),
  armDelay: uniform(0.3),
  /** Fibres du pinceau sur la largeur d'un bras, et leur poids. */
  fibres: uniform(90),
  fibre: uniform(0.035),
  /** Larges taches qui cassent la regularite : leur poids et leur nombre sur la hauteur de l'ecran. */
  blot: uniform(0.07),
  blotScale: uniform(3.2),
};

/** Repetitions de la texture de bruit par unite : ses taches ont la taille de celles du Perlin qu'elle remplace. */
const NOISE_SCALE = 0.35;
/** Marge du front avant le premier pixel et apres le dernier : aucun ne bascule au depart, tous a l'arrivee. */
const FRONT_MARGIN = 0.02;
/** Au-dela, la derivee de l'ordre saute (bord d'un bras) : le lissage reste celui d'un pixel ordinaire. */
const MAX_AA = 0.002;

/** 1 la ou la carte est decouverte, 0 la ou la page couvre encore. Le meme a toutes les passes : il ne lit que l'ecran. */
export function mapUncovered(): Node {
  const p = screenCoordinate.sub(screenSize.mul(0.5)).div(screenSize.y);
  const radius = length(p).div(length(screenSize.mul(0.5)).div(screenSize.y));
  const t = pageTransition;
  const turn = atan(p.y, p.x).div(Math.PI * 2).add(0.5).add(t.rotation);
  const arm = fract(turn.mul(t.arms).add(radius.mul(t.twist)));
  // Bruit peint plutot que Perlin calcule : ce masque est evalue sur chaque pixel de l'ecran.
  const fibres = noiseAt(vec2(arm.mul(t.fibres), radius.mul(4)).mul(NOISE_SCALE));
  const blots = noiseAt(p.mul(t.blotScale).mul(NOISE_SCALE));
  const order = radius.mul(t.radius).add(arm.mul(t.armDelay)).add(fibres.mul(t.fibre)).add(blots.mul(t.blot));
  // Bornes de l'ordre pour tous les reglages (un retard negatif, de grosses taches) : le bruit tient dans
  // [-1, 1], le bras dans [0, 1]. Une borne fixe laissait des pixels sous la page a l'arrivee.
  const spread = t.fibre.abs().add(t.blot.abs());
  const first = min(t.armDelay, 0).sub(spread).sub(FRONT_MARGIN);
  const last = t.radius.add(max(t.armDelay, 0)).add(spread).add(FRONT_MARGIN);
  const front = mix(first, last, t.progress);
  const aa = fwidth(order).min(MAX_AA);
  return smoothstep(front.sub(aa), front.add(aa), order).oneMinus();
}

/** Page d'avant la carte : le ton qu'on prete au papier pour qu'il porte quelques hachures (1 : papier nu). */
const IDLE_TONE = 0.72;
/**
 * Degrade radial facon CSS, en part de l'ecran : ellipse de rayons `radii` centree en `at`, et paliers
 * d'opacite (position sur le rayon, alpha), interpoles lineairement comme `radial-gradient`.
 */
interface CssRadial {
  at: readonly [number, number];
  radii: readonly [number, number];
  stops: readonly (readonly [number, number])[];
}

/**
 * Page d'entree, reprise de la maquette (`01-entree.html`) : une masse d'encre hors centre a gauche, fondue par
 * un masque radial (opacite 0,66), et un lavis de papier sur la colonne de texte. Degrades ramenes a l'ecran
 * (y vers le bas). La masse est ici la carte elle-meme : plus a droite que dans la maquette, sinon elle ne
 * montrerait que la mer, et le lavis resserre sur le titre, sinon il l'effacerait.
 */
const PAGE = {
  mass: {
    at: [0.34, 0.56],
    radii: [0.5, 0.62],
    stops: [
      [0, 1],
      [0.46, 0.75],
      [0.78, 0],
    ],
    opacity: 0.66,
  },
  wash: {
    at: [0.5, 0.3],
    radii: [0.36, 0.42],
    stops: [
      [0, 0.95],
      [0.58, 0.9],
      [0.88, 0.25],
      [1, 0],
    ],
  },
} as const;

/** Opacite d'un degrade radial de la maquette au pixel courant, en part de l'ecran (y vers le bas, comme en CSS). */
function cssRadial({ at, radii, stops }: CssRadial): Node {
  const t = length(screenCoordinate.div(screenSize).sub(vec2(...at)).div(vec2(...radii)));
  let alpha: Node = float(stops[stops.length - 1]![1]);
  for (let i = stops.length - 2; i >= 0; i--) {
    const [from, a] = stops[i]!;
    const [to, b] = stops[i + 1]!;
    alpha = mix(mix(float(a), float(b), t.sub(from).div(to - from).clamp(0, 1)), alpha, step(to, t));
  }
  return alpha;
}

/**
 * Page d'entree posee sur la carte `map` deja dessinee, composee comme la maquette : la meme feuille `paper` portant
 * quelques hachures, une masse d'encre a gauche (la carte fondue par un masque radial), un lavis de papier sur la
 * colonne de texte. `mapUncovered` la retire ; le masque de la carte, lui, ne bouge pas.
 */
export function pageOver(map: Node, paper: Node, pixel: Node): Node {
  return Fn(() => {
    const color = map.toVar();
    // Branche sur un uniforme : une fois la carte decouverte, tous les pixels la sautent et la page ne coute plus rien.
    If(pageTransition.progress.lessThan(1), () => {
      const idle = luminance(paper).max(0).pow(1 / 2.2).mul(IDLE_TONE);
      let page: Node = inkOnPaper(inkCoverage(idle, pixel, float(1)), pixel, paper);
      page = mix(page, map, cssRadial(PAGE.mass).mul(PAGE.mass.opacity));
      page = mix(page, inkSettings.paper, cssRadial(PAGE.wash));
      color.assign(mix(page, map, mapUncovered()));
    });
    return color;
  })();
}
