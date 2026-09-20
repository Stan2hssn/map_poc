import { attribute, cameraPosition, cameraWorldMatrix, color, dot, positionGeometry, smoothstep, texture, uniform, vec2 } from "three/tsl";
import { Color, DoubleSide, LinearSRGBColorSpace, Vector2 } from "three";
import { MeshBasicNodeMaterial, type Texture } from "three/webgpu";

/**
 * Encre des etiquettes, prise telle quelle (`LinearSRGBColorSpace` : pas de conversion) : le calque ecrit
 * directement sur le canvas, ou ces octets sont deja les octets sRGB affiches (`OverlayPass`).
 */
const INK = new Color().setHex(0x1d2a4d, LinearSRGBColorSpace);
/** Le champ de distance vaut 0,5 sur le trait ; le bord s'adoucit sur cette part de part et d'autre. */
const EDGE = { level: 0.5, soft: 0.08 };

export const labelSettings = {
  /** Taille du rendu en pixels : les etiquettes gardent la meme taille a l'ecran. */
  resolution: uniform(new Vector2(1, 1)),
  /** Unites de scene par pixel et par unite de distance (2 tan(fov / 2) / hauteur). */
  perspective: uniform(0.001),
  /** Part dessinee (0 : rien), pour l'apparition. */
  reveal: uniform(1),
};

/**
 * Etiquettes des villes dessinees dans la scene : un quadrilatere par caractere (et par trait), tourne vers la
 * camera autour d'un point ancre dans le terrain et dimensionne en pixels, donc de taille constante a l'ecran.
 * Le dessin vient d'un atlas de champs de distance (`SdfFont`) : le texte reste net a toute taille.
 *
 * Attributs par instance : `glyph` (uv du caractere dans l'atlas), `screen` (decalage x, y et taille en pixels
 * depuis le point ancre) et `anchor` (le point, en unites de scene). Dessine dans une scene a part
 * (`Labels3DNode`), posee sur l'image finie par `OverlayPass` : la passe d'encre remplace toute l'image qu'elle
 * traite, un texte rendu avec le terrain y serait hachure. Au survol, c'est la ville au sol qui passe au rouge
 * (`inkSettings.hover`), pas le texte.
 */
export function createLabelMaterial(atlas: Texture): MeshBasicNodeMaterial {
  // Deux faces : l'axe y de l'ecran descend, celui de la scene monte, et cette inversion retourne le sens des
  // triangles du quadrilatere. En une seule face, toutes les etiquettes sont dos a la camera et disparaissent.
  const material = new MeshBasicNodeMaterial({ transparent: true, depthTest: false, depthWrite: false, side: DoubleSide });
  const glyph = attribute("glyph", "vec4");
  const screen = attribute("screen", "vec4");
  const anchor = attribute("anchor", "vec3");

  // Panneau face a la camera : le pixel devient une longueur de scene a la distance du point ancre.
  const corner = positionGeometry.xy.add(0.5);
  const offset = screen.xy.add(corner.mul(screen.zw));
  const right = cameraWorldMatrix[0].xyz;
  const up = cameraWorldMatrix[1].xyz;
  // Profondeur de vue, pas distance euclidienne : la perspective divise par la troisieme coordonnee de vue.
  // Avec la distance, un point loin de l'axe du regard s'ecarte d'autant plus que la vue est large, et la boite
  // cliquable (calculee, elle, par la projection) ne tombe plus sur le texte.
  const depth = dot(cameraPosition.sub(anchor), cameraWorldMatrix[2].xyz).abs().max(1e-4);
  const unit = labelSettings.perspective.mul(depth);
  material.positionNode = anchor.add(right.mul(offset.x.mul(unit))).sub(up.mul(offset.y.mul(unit)));

  const uv = vec2(glyph.x.add(corner.x.mul(glyph.z)), glyph.y.add(corner.y.mul(glyph.w)));
  const distance = texture(atlas, uv).r;
  material.colorNode = color(INK);
  material.opacityNode = smoothstep(EDGE.level - EDGE.soft, EDGE.level + EDGE.soft, distance).mul(labelSettings.reveal);
  return material;
}

/** Taille de l'ecran et ouverture de la camera : un pixel devient une longueur de scene (voir `perspective`). */
export function labelViewport(width: number, height: number, fovDegrees: number): void {
  labelSettings.resolution.value.set(width, height);
  labelSettings.perspective.value = (2 * Math.tan((fovDegrees * Math.PI) / 360)) / Math.max(1, height);
}
