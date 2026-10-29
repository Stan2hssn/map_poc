import type { Cp } from "./Timeline.type.ts";

/** Noms du selecteur d'interpolation du panneau Timeline ; seul `bezier` lit les points de controle. */
export const EASE_NAMES = [
  "hold",
  "linear",
  "easeIn",
  "easeOut",
  "easeInOut",
  "bezier",
] as const;

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

/** Inverse x(u) par Newton puis lit y(u) : converge vite sur les courbes monotones, seules permises par le panneau. */
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

/** `u` : fraction de l'intervalle entre deux keyframes. */
export function sampleEase(name: string | undefined, u: number, cp?: Cp): number {
  const t = Math.min(1, Math.max(0, u));
  switch (name) {
    // Zero donne exactement `a` dans `a + (b - a) * ease(u)` : la valeur tient jusqu'au keyframe suivant.
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
