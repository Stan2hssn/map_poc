/**
 * Ce que le moteur promet a un editeur de timeline (le panneau Timeline de SONDE), decrit CHEZ LUI : la
 * spice vit hors du depot, et le projet doit tourner et typer sans elle. Le typage structurel fait le reste —
 * tant que ces declarations decrivent la meme forme que celles de la spice, un `Theatre` reste accepte par
 * son panneau sans qu'aucun des deux ne connaisse l'autre.
 */

/** Points de controle d'une courbe de Bezier cubique, en x1 y1 x2 y2. */
export type Cp = [number, number, number, number];

export interface TimelineKeyframe {
  t: number;
  v: number;
  e?: string;
  cp?: Cp;
}

export type TimelineTrack = TimelineKeyframe[];

/**
 * Sous-ensemble d'un theatre qu'un editeur sait piloter.
 *
 * Les membres optionnels sont des DEGRADATIONS explicites, pas des oublis :
 * un hote qui ne sait pas retirer un keyframe laisse simplement la touche
 * Suppr inerte, plutot que de laisser croire a une suppression possible.
 */
export interface TimelineTheatre {
  readonly id: string;
  readonly duration: number;
  readonly playhead: number;
  readonly playing: boolean;
  play(): unknown;
  pause(): unknown;
  seek(t: number): unknown;
  objectIds(): string[];
  tracksOf(id: string): Record<string, TimelineTrack> | undefined;
  markersMap(): Record<string, number>;
  /**
   * Proprietes que l'hote sait animer, keyframees ou non. `tracksOf` ne rend
   * que ce que l'etat a deja cree : sans ce rappel une propriete n'apparait
   * qu'une fois animee, et on ne pourrait jamais poser sa PREMIERE cle.
   */
  registeredProps?(): Record<string, string[]>;
  putKeyframe(id: string, prop: string, kf: TimelineKeyframe): void;
  moveKeyframe(id: string, prop: string, fromT: number, toT: number): void;
  setEase(id: string, prop: string, atT: number, ease: string, cp?: Cp): void;
  removeKeyframe?(id: string, prop: string, atT: number): void;
  /**
   * Valeur que la scene tient pour une propriete, animee ou non. La timeline
   * l'affiche sous la tete de lecture, et une premiere cle nait sur elle plutot
   * que sur zero. Absent : la valeur montree et editee est celle de la piste au
   * playhead, zero pour une piste vide.
   */
  currentValue?(id: string, prop: string): number;
  snapshot(): unknown;
  restore?(state: unknown): void;
  tick(cb: () => void): () => void;
}
