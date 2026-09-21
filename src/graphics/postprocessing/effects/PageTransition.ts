import { atan, float, fract, fwidth, length, mix, mx_noise_float, screenCoordinate, screenSize, smoothstep, uniform, vec2 } from "three/tsl";
import type { Node } from "three/webgpu";

/**
 * Passage de la page d'entree a la carte : un masque de composition pose a l'ecran, qui decouvre la carte deja
 * dessinee sous la page. Il ne doit rien au masque de la carte — celui-ci ne s'anime jamais.
 *
 * L'ordre dans lequel les pixels basculent dessine des coups de pinceau qui tournent depuis le centre, comme
 * les transitions de summer-afternoon : quelques bras en spirale, chacun decouvert du centre vers l'exterieur et
 * un peu apres le precedent, des fibres etirees le long du trait et de larges taches qui cassent la regularite.
 * Un seuil sur cet ordre, lisse sur un pixel : le bord est franc, jamais flou.
 */
export const pageTransition = {
  /** 0 : la page couvre tout ; 1 : la carte est entierement decouverte. */
  progress: uniform(0),
};

/** Bras de la spirale, et le tour qu'ils font du centre au coin de l'ecran. */
const ARMS = 3;
const TWIST = 1.35;
/** Fibres du pinceau sur la largeur d'un bras. */
const FIBRES = 90;
/** Poids de l'ordre : distance au centre, place dans le bras, fibres, taches. */
const WEIGHT = { radius: 0.6, arm: 0.3, fibre: 0.035, blot: 0.07 };
/** Le front part d'avant le centre et finit apres le dernier pixel, fibres et taches comprises. */
const FRONT = { from: -0.08, to: WEIGHT.radius + WEIGHT.arm + WEIGHT.fibre + WEIGHT.blot + 0.02 };
/** Au-dela, la derivee de l'ordre saute (bord d'un bras) : le lissage reste celui d'un pixel ordinaire. */
const MAX_AA = 0.002;

/** 1 la ou la carte est decouverte, 0 la ou la page couvre encore. Le meme a toutes les passes : il ne lit que l'ecran. */
export function mapUncovered(): Node {
  const p = screenCoordinate.sub(screenSize.mul(0.5)).div(screenSize.y);
  const radius = length(p).div(length(screenSize.mul(0.5)).div(screenSize.y));
  const turn = atan(p.y, p.x).div(Math.PI * 2).add(0.5);
  const arm = fract(turn.mul(ARMS).add(radius.mul(TWIST)));
  const fibres = mx_noise_float(vec2(arm.mul(FIBRES), radius.mul(4)));
  const blots = mx_noise_float(p.mul(3.2));
  const order = radius
    .mul(WEIGHT.radius)
    .add(arm.mul(WEIGHT.arm))
    .add(fibres.mul(WEIGHT.fibre))
    .add(blots.mul(WEIGHT.blot));
  const front = mix(float(FRONT.from), float(FRONT.to), pageTransition.progress);
  const aa = fwidth(order).min(MAX_AA);
  return smoothstep(front.sub(aa), front.add(aa), order).oneMinus();
}
