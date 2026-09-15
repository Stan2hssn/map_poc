import type { Texture } from "three";
import { fract, luminance, mix, screenSize, smoothstep, texture, uv, vec2, vec3, vec4 } from "three/tsl";
import type { Node } from "three/webgpu";
import type { FinalFxConfig } from "../types.ts";

// Portage TSL de `webgl/final.frag`. Fusion `normal` seulement : `fx.blend` est ignore.
export function finalEffect(input: Node, fx: FinalFxConfig, grain: Texture | null): Node {
  const aspect = vec2(screenSize.x.div(screenSize.y), 1);
  const base = input.rgb;

  const grained = grain
    ? base
        .add(
          texture(grain, fract(uv().mul(aspect).mul(fx.grainScale))).r.mul(2).sub(1)
            .mul(fx.noise)
            .mul(mix(1, 0.35, smoothstep(0, 1, luminance(base))))
        )
        .clamp(0, 1)
    : base;

  const { x, y } = fx.vignetteCenter;
  const { r, g, b } = fx.vignetteColor;
  const vignette = smoothstep(fx.vignetteRadius, 1, uv().sub(vec2(x, y)).mul(aspect).length())
    .pow(Math.max(fx.vignettePower, 1e-4))
    .mul(fx.vignetteStrength)
    .clamp(0, 1);

  return vec4(mix(grained, vec3(r, g, b), vignette), input.a);
}
