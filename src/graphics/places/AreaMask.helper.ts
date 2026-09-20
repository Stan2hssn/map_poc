import { CanvasTexture, ClampToEdgeWrapping, LinearFilter, Vector4 } from "three";
import { signedDistanceField } from "@graphics/text/DistanceField.ts";
import type { Ring } from "./AdminAreas.ts";

/** Cote de la texture du masque : le champ de distance est lisse, il n'a pas besoin de plus. */
const SIZE = 256;
/** Marge autour du contour, en part de son cadre : le champ a la place de descendre de part et d'autre. */
const MARGIN = 0.06;
/** Texels de part et d'autre du bord sur lesquels le champ passe de 0 a 1. */
const SPREAD = 24;

/**
 * Contour du lieu survole, rasterise en champ de distance dans une texture calee sur son cadre en degres : le
 * sol l'echantillonne par sa longitude et sa latitude (`terrainSettings.hoverArea`) et marque ses pixels pour
 * la passe d'encre. Le champ vaut 0,5 sur la limite, plus haut dedans.
 *
 * Un champ plutot qu'un aplat : le sol en tire un trait de perimetre d'une largeur constante a l'ecran, alors
 * qu'un trait trace dans la texture vaudrait moins d'un pixel en vue France et plusieurs en vue rapprochee.
 *
 * Le cadre est publie en (ouest, nord, etendue en longitude, etendue en latitude, cette derniere negative
 * comme `geoSize` : la latitude descend avec les lignes de la texture). Etendue nulle : rien n'est survole.
 */
export class AreaMaskHelper {
  readonly bounds = new Vector4(0, 0, 0, 0);
  readonly texture: CanvasTexture;
  private readonly _canvas: HTMLCanvasElement;
  private readonly _pen: CanvasRenderingContext2D;

  constructor() {
    this._canvas = document.createElement("canvas");
    this._canvas.width = this._canvas.height = SIZE;
    this._pen = this._canvas.getContext("2d", { willReadFrequently: true })!;
    this.texture = new CanvasTexture(this._canvas);
    this.texture.wrapS = this.texture.wrapT = ClampToEdgeWrapping;
    this.texture.minFilter = this.texture.magFilter = LinearFilter;
    this.texture.generateMipmaps = false;
    // La premiere ligne du canvas est le nord : sans cela, three retourne l'image et le contour se pose a l'envers.
    this.texture.flipY = false;
  }

  /** Dessine le contour ; sans anneaux, le masque s'eteint. */
  set(rings: Ring[] | undefined): void {
    if (!rings?.length) {
      this.bounds.set(0, 0, 0, 0);
      return;
    }
    let west = Infinity;
    let east = -Infinity;
    let south = Infinity;
    let north = -Infinity;
    for (const ring of rings) {
      for (const [lon, lat] of ring) {
        west = Math.min(west, lon);
        east = Math.max(east, lon);
        south = Math.min(south, lat);
        north = Math.max(north, lat);
      }
    }
    const padX = (east - west) * MARGIN;
    const padY = (north - south) * MARGIN;
    west -= padX;
    east += padX;
    south -= padY;
    north += padY;

    const spanLon = east - west;
    const spanLat = south - north;
    this._pen.clearRect(0, 0, SIZE, SIZE);
    this._pen.fillStyle = "#fff";
    this._pen.beginPath();
    for (const ring of rings) {
      ring.forEach(([lon, lat], i) => {
        const x = ((lon - west) / spanLon) * SIZE;
        const y = ((lat - north) / spanLat) * SIZE;
        if (i === 0) this._pen.moveTo(x, y);
        else this._pen.lineTo(x, y);
      });
      this._pen.closePath();
    }
    this._pen.fill();

    const pixels = this._pen.getImageData(0, 0, SIZE, SIZE).data;
    const filled = new Uint8Array(SIZE * SIZE);
    for (let i = 0; i < filled.length; i++) filled[i] = pixels[i * 4 + 3]! > 127 ? 255 : 0;
    const field = signedDistanceField(filled, SIZE, SIZE, SPREAD);
    const image = this._pen.createImageData(SIZE, SIZE);
    for (let i = 0; i < field.length; i++) {
      image.data[i * 4] = image.data[i * 4 + 1] = image.data[i * 4 + 2] = field[i]!;
      image.data[i * 4 + 3] = 255;
    }
    this._pen.putImageData(image, 0, 0);
    this.texture.needsUpdate = true;
    this.bounds.set(west, north, spanLon, spanLat);
  }

  dispose(): void {
    this.texture.dispose();
  }
}
