import { attribute, color, mix, positionGeometry, smoothstep, texture, uniform, vec2, vec3 } from "three/tsl";
import { Color, DoubleSide, LinearSRGBColorSpace } from "three";
import { MeshBasicNodeMaterial, type Texture } from "three/webgpu";

/**
 * Encre des etiquettes et encre du survol, prises telles quelles (`LinearSRGBColorSpace` : pas de conversion) :
 * le calque ecrit directement sur le canvas, ou ces octets sont deja les octets sRGB affiches (`OverlayPass`).
 */
const INK = new Color().setHex(0x1d2a4d, LinearSRGBColorSpace);
const HOVER = new Color().setHex(0xb3452f, LinearSRGBColorSpace);
/** Le champ de distance vaut 0,5 sur le trait ; le bord s'adoucit sur cette part de part et d'autre. */
const EDGE = { level: 0.5, soft: 0.08 };

export const labelSettings = {
  /** Part dessinee (0 : rien), pour l'apparition. */
  reveal: uniform(1),
};

/**
 * Etiquettes des villes : un quadrilatere par caractere (et par trait), pose dans le repere de son etiquette,
 * en pixels. Le panneau face a la camera n'est plus calcule ici : c'est le groupe de l'etiquette qui porte le
 * point ancre, l'orientation de la camera et l'echelle pixel vers scene (`Labels3DNode`). Le dessin et la zone
 * cliquable partagent ainsi une seule transformation, et ne peuvent plus diverger — c'est ce qui rendait les
 * noms inattrapables.
 *
 * Attributs par instance : `glyph` (uv du caractere dans l'atlas), `screen` (coin et taille en pixels dans le
 * repere de l'etiquette) et `tint` (part de survol, le texte passe a l'accent). `reveal` dit la part dessinee :
 * l'intro a la sienne, sinon son mot suivrait l'apparition des noms de la carte.
 */
export function createLabelMaterial(atlas: Texture, reveal: ReturnType<typeof uniform<number>> = labelSettings.reveal): MeshBasicNodeMaterial {
  // Deux faces : l'axe y de l'ecran descend, celui du repere monte, et cette inversion retourne le sens des
  // triangles du quadrilatere. En une seule face, toutes les etiquettes sont dos a la camera et disparaissent.
  const material = new MeshBasicNodeMaterial({ transparent: true, depthTest: false, depthWrite: false, side: DoubleSide });
  const glyph = attribute("glyph", "vec4");
  const screen = attribute("screen", "vec4");
  const tint = attribute("tint", "float");

  // Repere de l'etiquette : x vers la droite, y vers le haut. Les pixels de l'ecran descendent, d'ou le signe.
  const corner = positionGeometry.xy.add(0.5);
  const offset = screen.xy.add(corner.mul(screen.zw));
  material.positionNode = vec3(offset.x, offset.y.negate(), 0);

  const uv = vec2(glyph.x.add(corner.x.mul(glyph.z)), glyph.y.add(corner.y.mul(glyph.w)));
  const distance = texture(atlas, uv).r;
  material.colorNode = mix(color(INK), color(HOVER), tint);
  material.opacityNode = smoothstep(EDGE.level - EDGE.soft, EDGE.level + EDGE.soft, distance).mul(reveal);
  return material;
}

/** Unites de scene par pixel et par unite de profondeur de vue : `2 tan(fov / 2) / hauteur`. */
export function pixelScale(height: number, fovDegrees: number): number {
  return (2 * Math.tan((fovDegrees * Math.PI) / 360)) / Math.max(1, height);
}
