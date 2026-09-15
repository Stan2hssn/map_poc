// postprocessing "Effect" fragment (uses mainImage API)

uniform sampler2D tGrain;           // tileable monochrome grain (e.g. 512x512)
uniform vec2 uResolution;          // viewport (width, height)
uniform float uTime;

// — Grain
uniform float uGrainScale;          // 4..10 (frequency)
uniform float uNoiseStrength;       // 0..1

// — Vignette / halo
uniform vec2 uVignetteCenter;      // usually vec2(0.5, 0.5)
uniform float uVignetteRadius;      // 0.45..0.75 (where dimming starts)
uniform float uVignetteStrength;    // 0..1  (how strong)
uniform float uVignettePower;       // 1.2..3.0 (falloff)
uniform vec3 uVignetteColor;       // neutral by default; tint per project

float luma(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {

  vec3 col = inputColor.rgb;

  // ---------------------------
  // Film grain (tileable + animated)
  // ---------------------------
  vec2 aspect = vec2(uResolution.x / uResolution.y, 1.0);

  // animated offset to avoid static pattern
  vec2 gUv = fract((uv * aspect) * uGrainScale);

  // map to [-1, 1]
  float g = texture(tGrain, gUv).r * 2.0 - 1.0;

  // less grain on highlights
  float lum = luma(col);
  float grainAtten = mix(1.0, 0.35, smoothstep(0.0, 1.0, lum));

  col += g * uNoiseStrength * grainAtten;
  col = clamp(col, 0.0, 1.0);

  vec2 vignetteUv = uv - uVignetteCenter;
  vignetteUv.x *= uResolution.x / max(uResolution.y, 1.0);
  float dist = length(vignetteUv);
  float vignette = smoothstep(uVignetteRadius, 1.0, dist);
  vignette = pow(vignette, max(uVignettePower, 0.0001));
  float vignetteMix = clamp(vignette * uVignetteStrength, 0.0, 1.0);
  col = mix(col, uVignetteColor, vignetteMix);

  outputColor = vec4(col, inputColor.a);
}
