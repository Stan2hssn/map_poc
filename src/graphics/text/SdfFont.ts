import { DataTexture, LinearFilter, RedFormat, UnsignedByteType } from "three";
import { signedDistanceField } from "./DistanceField.ts";

/** Place d'un caractere dans l'atlas (uv) et sa boite, en cadratins (la taille du texte vaut 1). */
export interface Glyph {
  /** Coin haut-gauche et taille dans l'atlas, en uv. */
  u: number;
  v: number;
  du: number;
  dv: number;
  /** Boite du dessin par rapport au point d'ecriture, en cadratins (y vers le bas). */
  left: number;
  top: number;
  width: number;
  height: number;
  /** Avance jusqu'au caractere suivant. */
  advance: number;
}

export interface SdfFont {
  texture: DataTexture;
  glyphs: Map<string, Glyph>;
  /** Le blanc plein de l'atlas : un trait se dessine avec le meme materiau que le texte. */
  solid: Glyph;
  /** Un disque plein : le point au sol des etiquettes. */
  disc: Glyph;
  /** Demi-largeur du degrade, en cadratins : le shader y adoucit le bord. */
  spread: number;
}

/** Taille de rendu d'un caractere (px) et marge autour, ou le champ de distance s'etale. */
const SIZE = 48;
const PAD = 8;
/** Caracteres graves : de quoi ecrire les noms de lieux et leurs numeros. */
export const CHARSET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzÀÂÄÇÈÉÊËÎÏÔÖÙÛÜàâäçèéêëîïôöùûüñÑ .,'-()°/&";

/**
 * Atlas de champs de distance signes d'une police deja chargee par la page. Chaque caractere est rendu une
 * fois a `SIZE` px, puis converti en distance au bord : le shader le retrouve net a toute echelle, sans
 * dependance ni fichier a livrer. Une police MSDF (trois canaux) garderait les angles plus francs ; a cette
 * taille de texte, la difference ne se voit pas.
 */
export function createSdfFont(family: string, weight = 600, characters = CHARSET): SdfFont {
  const cell = SIZE + 2 * PAD;
  // Deux cases de plus que les caracteres : le carre plein et le disque.
  const columns = Math.ceil(Math.sqrt(characters.length + 2));
  const rows = Math.ceil((characters.length + 2) / columns);
  const width = columns * cell;
  const height = rows * cell;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.fillStyle = "#000";
  context.fillRect(0, 0, width, height);
  // La graisse precede la taille : `48px 600 Manrope` ne serait pas une police valide, et le canvas
  // retomberait sur ses 10 px par defaut (des avances dix fois trop courtes).
  context.font = `${weight} ${SIZE}px ${family}`;
  context.textBaseline = "alphabetic";
  context.fillStyle = "#fff";

  const boxes: { char: string; column: number; row: number; metrics: TextMetrics }[] = [];
  characters.split("").forEach((char, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const metrics = context.measureText(char);
    context.fillText(char, column * cell + PAD, row * cell + PAD + SIZE * 0.8);
    boxes.push({ char, column, row, metrics });
  });
  // Deux dernieres cases : un carre plein (les traits) et un disque (le point au sol).
  const solidColumn = characters.length % columns;
  const solidRow = Math.floor(characters.length / columns);
  context.fillRect(solidColumn * cell + PAD, solidRow * cell + PAD, SIZE, SIZE);
  const discColumn = (characters.length + 1) % columns;
  const discRow = Math.floor((characters.length + 1) / columns);
  context.beginPath();
  context.arc(discColumn * cell + cell / 2, discRow * cell + cell / 2, SIZE / 2, 0, 2 * Math.PI);
  context.fill();

  const pixels = context.getImageData(0, 0, width, height).data;
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i++) mask[i] = pixels[i * 4]!;
  const texture = new DataTexture(signedDistanceField(mask, width, height, PAD), width, height, RedFormat, UnsignedByteType);
  texture.minFilter = texture.magFilter = LinearFilter;
  texture.needsUpdate = true;

  // La case entiere est prise : le degrade deborde du dessin, et c'est lui qui fait le bord. Le point
  // d'ecriture est a (PAD, PAD + 0,8 x SIZE) dans la case, d'ou le coin de la case par rapport a lui.
  /** Case entiere (`inset` 0) ou son carre interieur : pour les formes pleines, sans point d'ecriture. */
  const cellGlyph = (column: number, row: number, inset: number): Glyph => ({
    u: (column * cell + inset) / width,
    v: (row * cell + inset) / height,
    du: (cell - 2 * inset) / width,
    dv: (cell - 2 * inset) / height,
    left: 0,
    top: 0,
    width: 1,
    height: 1,
    advance: 1,
  });

  const glyphs = new Map<string, Glyph>();
  for (const { char, column, row, metrics } of boxes) {
    glyphs.set(char, {
      u: (column * cell) / width,
      v: (row * cell) / height,
      du: cell / width,
      dv: cell / height,
      left: -PAD / SIZE,
      top: -(PAD + SIZE * 0.8) / SIZE,
      width: cell / SIZE,
      height: cell / SIZE,
      advance: metrics.width / SIZE,
    });
  }
  return {
    texture,
    glyphs,
    solid: cellGlyph(solidColumn, solidRow, PAD),
    disc: cellGlyph(discColumn, discRow, 0),
    spread: PAD / SIZE,
  };
}

/** Largeur d'un texte, en cadratins. */
export function textWidth(font: SdfFont, text: string): number {
  let width = 0;
  for (const char of text) width += font.glyphs.get(char)?.advance ?? font.glyphs.get(" ")?.advance ?? 0.3;
  return width;
}
