import type {
  Cp,
  TimelineKeyframe,
  TimelineTheatre,
  TimelineTrack,
} from "./Timeline.type.ts";
import { sampleEase } from "./ease.ts";

/** Un scalaire de la scene que la timeline sait lire et ecrire. */
export interface TheatreBinding {
  get(): number;
  set(value: number): void;
}

export type TheatreBindings = Record<string, Record<string, TheatreBinding>>;

export interface TheatreOpts {
  id: string;
  /** Secondes. */
  duration: number;
  bindings: TheatreBindings;
  tracks?: Record<string, Record<string, TimelineTrack>>;
}

/**
 * Moteur de keyframes minimal pour le panneau Timeline de SONDE. Les pistes vivent ici, pas dans les noeuds :
 * un noeud qui connaitrait sa propre courbe ne serait plus editable.
 */
export class Theatre implements TimelineTheatre {
  readonly id: string;
  readonly duration: number;

  private readonly _bindings: TheatreBindings;
  private readonly _tracks: Record<string, Record<string, TimelineTrack>>;
  private readonly _listeners = new Set<() => void>();

  private _playhead = 0;
  private _playing = false;

  constructor(opts: TheatreOpts) {
    this.id = opts.id;
    this.duration = opts.duration;
    this._bindings = opts.bindings;
    this._tracks = opts.tracks ?? {};

    this._seedEmptyTracks();
    this.apply();
  }

  get playhead(): number {
    return this._playhead;
  }

  get playing(): boolean {
    return this._playing;
  }

  play(): void {
    // Lecture une fois la fin atteinte : on repart du debut plutot que de ne rien faire.
    if (this._playhead >= this.duration) this._playhead = 0;
    this._playing = true;
    this._notify();
  }

  pause(): void {
    this._playing = false;
    this._notify();
  }

  seek(t: number): void {
    this._playhead = Math.min(this.duration, Math.max(0, t));
    this.apply();
    this._notify();
  }

  /** Avance le playhead. Appele par l'hote depuis SA boucle, jamais d'un rAF interne. */
  advance(deltaSeconds: number): void {
    if (!this._playing) return;
    this._playhead += deltaSeconds;
    if (this._playhead >= this.duration) {
      this._playhead = this.duration;
      this._playing = false;
    }
    this.apply();
    this._notify();
  }

  /** Ecrit dans la scene la valeur de chaque piste au playhead courant. */
  apply(): void {
    for (const [objectId, props] of Object.entries(this._tracks)) {
      const bound = this._bindings[objectId];
      if (!bound) continue;
      for (const [prop, track] of Object.entries(props)) {
        const binding = bound[prop];
        if (!binding || track.length === 0) continue;
        binding.set(sampleTrack(track, this._playhead));
      }
    }
  }

  /** Valeur que la scene tient deja : la premiere cle d'une piste vide nait sur elle plutot que sur zero. */
  currentValue(objectId: string, prop: string): number {
    return this._bindings[objectId]?.[prop]?.get() ?? 0;
  }

  /** Tout ce que le theatre sait animer : sans cela une propriete non animee n'apparait pas au panneau. */
  registeredProps(): Record<string, string[]> {
    const sortie: Record<string, string[]> = {};
    for (const [objectId, props] of Object.entries(this._bindings)) {
      sortie[objectId] = Object.keys(props);
    }
    return sortie;
  }

  objectIds(): string[] {
    return Object.keys(this._tracks);
  }

  tracksOf(id: string): Record<string, TimelineTrack> | undefined {
    return this._tracks[id];
  }

  markersMap(): Record<string, number> {
    return {};
  }

  putKeyframe(id: string, prop: string, kf: TimelineKeyframe): void {
    const track = this._trackFor(id, prop);
    const at = track.findIndex((k) => Math.abs(k.t - kf.t) < 1e-4);
    if (at >= 0) track[at] = { ...track[at], ...kf };
    else track.push({ ...kf });
    track.sort((a, b) => a.t - b.t);
    this.apply();
    this._notify();
  }

  moveKeyframe(id: string, prop: string, fromT: number, toT: number): void {
    const track = this._trackFor(id, prop);
    const kf = track.find((k) => Math.abs(k.t - fromT) < 1e-4);
    if (!kf) return;
    kf.t = Math.min(this.duration, Math.max(0, toT));
    track.sort((a, b) => a.t - b.t);
    this.apply();
    this._notify();
  }

  setEase(id: string, prop: string, atT: number, ease: string, cp?: Cp): void {
    const kf = this._trackFor(id, prop).find((k) => Math.abs(k.t - atT) < 1e-4);
    if (!kf) return;
    kf.e = ease;
    if (cp) kf.cp = cp;
    this.apply();
    this._notify();
  }

  removeKeyframe(id: string, prop: string, atT: number): void {
    const track = this._trackFor(id, prop);
    const at = track.findIndex((k) => Math.abs(k.t - atT) < 1e-4);
    if (at < 0) return;
    track.splice(at, 1);
    this.apply();
    this._notify();
  }

  snapshot(): unknown {
    return { id: this.id, duration: this.duration, markers: {}, tracks: this._tracks };
  }

  /** Annulation du panneau : seules les pistes reviennent, recopiees pour que l'etat garde par l'appelant ne mute pas. */
  restore(state: unknown): void {
    const tracks = readTracks(state);
    if (!tracks) return;

    for (const objectId of Object.keys(this._tracks)) delete this._tracks[objectId];
    for (const [objectId, props] of Object.entries(tracks)) {
      const target: Record<string, TimelineTrack> = {};
      for (const [prop, track] of Object.entries(props)) {
        target[prop] = track.map((kf) => ({ ...kf }));
      }
      this._tracks[objectId] = target;
    }
    this._seedEmptyTracks();
    this.apply();
    this._notify();
  }

  tick(cb: () => void): () => void {
    this._listeners.add(cb);
    return () => {
      this._listeners.delete(cb);
    };
  }

  /** Une propriete absente de `tracksOf` ne pourrait jamais recevoir sa premiere cle. */
  private _seedEmptyTracks(): void {
    for (const [objectId, props] of Object.entries(this._bindings)) {
      const target = (this._tracks[objectId] ??= {});
      for (const prop of Object.keys(props)) target[prop] ??= [];
    }
  }

  private _trackFor(id: string, prop: string): TimelineTrack {
    const props = (this._tracks[id] ??= {});
    return (props[prop] ??= []);
  }

  private _notify(): void {
    for (const cb of this._listeners) cb();
  }
}

/** Un etat mal forme laisse le theatre intact plutot que de vider ses pistes. */
function readTracks(state: unknown): Record<string, Record<string, TimelineTrack>> | null {
  if (typeof state !== "object" || state === null) return null;
  const tracks = (state as { tracks?: unknown }).tracks;
  if (typeof tracks !== "object" || tracks === null) return null;
  return tracks as Record<string, Record<string, TimelineTrack>>;
}

/** Hors de son intervalle, une piste tient sa valeur de bord. */
export function sampleTrack(track: TimelineTrack, t: number): number {
  if (track.length === 0) return 0;
  const first = track[0] as TimelineKeyframe;
  if (t <= first.t) return first.v;
  const last = track[track.length - 1] as TimelineKeyframe;
  if (t >= last.t) return last.v;

  for (let i = 0; i < track.length - 1; i += 1) {
    const a = track[i] as TimelineKeyframe;
    const b = track[i + 1] as TimelineKeyframe;
    if (t < a.t || t > b.t) continue;
    const span = b.t - a.t;
    // Deux keyframes au meme temps : coupure franche, la seconde gagne.
    if (span <= 1e-6) return b.v;
    // Ease sortant (`a.e`) : convention du panneau, qui etiquette le segment `a -> b` avec `a.e`.
    return a.v + (b.v - a.v) * sampleEase(a.e, (t - a.t) / span, a.cp);
  }
  return last.v;
}
