// Contrat du panneau Timeline de SONDE, redeclare ici : le typage structurel suffit a ce qu'un `Theatre` y soit accepte.

/** Points de controle d'une courbe de Bezier cubique, en x1 y1 x2 y2. */
export type Cp = [number, number, number, number];

export interface TimelineKeyframe {
  t: number;
  v: number;
  e?: string;
  cp?: Cp;
}

export type TimelineTrack = TimelineKeyframe[];

/** Sous-ensemble d'un theatre qu'un editeur sait piloter ; un membre optionnel absent desactive la commande. */
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
  /** Proprietes animables, keyframees ou non. */
  registeredProps?(): Record<string, string[]>;
  putKeyframe(id: string, prop: string, kf: TimelineKeyframe): void;
  moveKeyframe(id: string, prop: string, fromT: number, toT: number): void;
  setEase(id: string, prop: string, atT: number, ease: string, cp?: Cp): void;
  removeKeyframe?(id: string, prop: string, atT: number): void;
  /** Valeur tenue par la scene ; absent, le panneau lit la piste au playhead. */
  currentValue?(id: string, prop: string): number;
  snapshot(): unknown;
  restore?(state: unknown): void;
  tick(cb: () => void): () => void;
}
