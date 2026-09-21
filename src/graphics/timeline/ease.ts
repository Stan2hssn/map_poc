import type { Cp } from "./Timeline.type.ts";

/**
 * Noms proposes dans le selecteur d'interpolation du panneau Timeline.
 * `bezier` est le seul a consommer les points de controle : les autres
 * ignorent `cp`, et le panneau masque alors son mini-editeur de courbe.
 */
export const EASE_NAMES = [
  "hold",
  "linear",
  "easeIn",
  "easeOut",
  "easeInOut",
  "bezier",
] as const;

export type EaseName = (typeof EASE_NAMES)[number];

const NEWTON_ITERATIONS = 6;
const NEWTON_EPSILON = 1e-6;

/** Composante d'une bezier cubique dont les extremites sont 0 et 1. */
function bezierAt(a: number, b: number, u: number): number {
  const v = 1 - u;
  return 3 * v * v * u * a + 3 * v * u * u * b + u * u * u;
}

function bezierSlope(a: number, b: number, u: number): number {
  const v = 1 - u;
  return 3 * v * v * a + 6 * v * u * (b - a) + 3 * u * u * (1 - b);
}

/**
 * Une bezier CSS n'est pas une fonction de u : elle donne x(u) et y(u). Il faut
 * donc inverser x pour retrouver le parametre, puis lire y. Newton converge en
 * quelques tours sur les courbes monotones, qui sont les seules que l'editeur
 * du panneau autorise.
 */
function cubicBezier(cp: Cp, x: number): number {
  const [x1, y1, x2, y2] = cp;
  if (x <= 0) return 0;
  if (x >= 1) return 1;

  let u = x;
  for (let i = 0; i < NEWTON_ITERATIONS; i += 1) {
    const dx = bezierAt(x1, x2, u) - x;
    if (Math.abs(dx) < NEWTON_EPSILON) break;
    const slope = bezierSlope(x1, x2, u);
    if (Math.abs(slope) < NEWTON_EPSILON) break;
    u -= dx / slope;
  }
  return bezierAt(y1, y2, u);
}

/**
 * `u` est deja normalise sur l'intervalle entre deux keyframes : cette fonction
 * ne connait ni la duree ni le temps absolu, seulement une fraction.
 */
export function sampleEase(name: string | undefined, u: number, cp?: Cp): number {
  const t = Math.min(1, Math.max(0, u));
  switch (name) {
    // Palier : la valeur du keyframe PRECEDENT tient jusqu'au suivant. Comme
    // l'echantillonnage interpole `a + (b - a) * ease(u)`, renvoyer zero sur
    // tout l'intervalle donne exactement `a` — et `sampleTrack` bascule sur `b`
    // des que le temps atteint le keyframe suivant.
    case "hold":
      return 0;
    case "easeIn":
      return t * t * t;
    case "easeOut":
      return 1 - Math.pow(1 - t, 3);
    case "easeInOut":
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    case "bezier":
      return cp ? cubicBezier(cp, t) : t;
    case "linear":
    default:
      return t;
  }
}
