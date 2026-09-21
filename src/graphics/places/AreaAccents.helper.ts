import { HOVER_SLOTS, terrainSettings } from "@graphics/materials/Terrain.material.ts";
import type { Ring } from "./AdminAreas.ts";
import { AreaMaskHelper } from "./AreaMask.helper.ts";

/** Vitesse a laquelle le rouge gagne un territoire, et le quitte (part par seconde). */
const PER_S = 2.2;
/** En deca, une part qui converge est consideree arrivee. */
const SETTLED = 0.01;

interface Slot {
  /** Territoire tenu par la place (son identite suffit), null si elle n'a jamais servi. */
  key: object | null;
  mask: AreaMaskHelper;
  value: number;
  target: number;
}

/**
 * Accents des territoires sur le sol. Chaque territoire accentue prend une place (`HOVER_SLOTS`) : son contour,
 * sa part de rouge. Quitte, il la garde le temps de refluer, et le suivant en prend une autre : les transitions
 * ne se coupent plus l'une l'autre. Revenir sur un territoire qui reflue le fait remonter d'ou il en est.
 */
export class AreaAccentsHelper {
  private readonly _slots: Slot[];
  private _held: object | null = null;

  constructor() {
    this._slots = Array.from({ length: HOVER_SLOTS }, (_, i) => {
      const mask = new AreaMaskHelper();
      // Posee avant la premiere image : un materiau deja compile garderait la texture d'attente.
      terrainSettings.hoverAreas[i]!.value = mask.texture;
      return { key: null, mask, value: 0, target: 0 };
    });
  }

  /** Territoire tenu (null : aucun). Sans contour encore connu, `draw` le posera a son arrivee. */
  hold(key: object | null, rings?: Ring[]): void {
    if (key === this._held) return;
    this._held = key;
    for (const slot of this._slots) slot.target = key !== null && slot.key === key ? 1 : 0;
    if (!key || this._slots.some((slot) => slot.key === key)) return;
    // Une place libre, sinon celle qui a le plus reflue : c'est elle qui se voit le moins partir.
    const slot = this._slots.reduce((best, next) => (next.value < best.value ? next : best));
    slot.key = key;
    slot.value = 0;
    slot.target = 1;
    this._draw(slot, rings);
  }

  /** Contour arrive apres coup (une commune le demande au premier survol). */
  draw(key: object, rings: Ring[]): void {
    const slot = this._slots.find((candidate) => candidate.key === key);
    if (slot) this._draw(slot, rings);
  }

  /** Territoire tenu en ce moment. */
  get held(): object | null {
    return this._held;
  }

  /** Vrai quand aucune part de rouge ne bouge plus. */
  get settled(): boolean {
    return this._slots.every((slot) => slot.value === slot.target);
  }

  /** Avance chaque part vers sa cible ; `ms` est deja borne par l'appelant. */
  step(ms: number): void {
    const k = Math.min(1, (ms / 1000) * PER_S);
    this._slots.forEach((slot, i) => {
      slot.value = Math.abs(slot.target - slot.value) < SETTLED ? slot.target : slot.value + (slot.target - slot.value) * k;
      terrainSettings.hoverReveals[i]!.value = slot.value;
    });
  }

  dispose(): void {
    for (const slot of this._slots) slot.mask.dispose();
  }

  private _draw(slot: Slot, rings: Ring[] | undefined): void {
    slot.mask.set(rings);
    terrainSettings.hoverBounds[this._slots.indexOf(slot)]!.value.copy(slot.mask.bounds);
  }
}
