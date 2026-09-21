import { atan, fract, fwidth, length, max, min, mix, mx_noise_float, screenCoordinate, screenSize, smoothstep, uniform, vec2 } from "three/tsl";
import type { Node } from "three/webgpu";

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
  const fibres = mx_noise_float(vec2(arm.mul(t.fibres), radius.mul(4)));
  const blots = mx_noise_float(p.mul(t.blotScale));
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
