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
  markers?: Record<string, number>;
}

/**
 * Moteur de keyframes minimal, juste ce que le panneau Timeline de SONDE
 * attend : il pilote les quelques scalaires de
 * l'intro, et c'est precisement ce qui rend l'intro reglable a la main plutot
 * qu'ecrite en dur dans le code.
 *
 * Les pistes vivent ici, pas dans les noeuds : un noeud expose un scalaire, la
 * timeline decide de sa valeur dans le temps. L'inverse — un noeud qui
 * connaitrait sa propre courbe — rendrait l'edition impossible.
 */
export class Theatre implements TimelineTheatre {
  readonly id: string;
  readonly duration: number;

  private readonly _bindings: TheatreBindings;
  private readonly _tracks: Record<string, Record<string, TimelineTrack>>;
  private readonly _markers: Record<string, number>;
  private readonly _listeners = new Set<() => void>();

  private _playhead = 0;
  private _playing = false;

  constructor(opts: TheatreOpts) {
    this.id = opts.id;
    this.duration = opts.duration;
    this._bindings = opts.bindings;
    this._tracks = opts.tracks ?? {};
    this._markers = opts.markers ?? {};

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
    // Rejouer depuis la fin releve du debut : sans ca, appuyer sur Lecture une
    // fois l'intro terminee ne ferait rien du tout.
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

  /**
   * Valeur que la scene tient DEJA pour une propriete.
   *
   * Le panneau s'en sert pour poser une cle sans faire sauter la valeur — et
   * surtout pour la PREMIERE cle d'une piste vide, ou l'echantillonnage n'a rien
   * a lire. Sans cette methode il retombait sur zero.
   */
  currentValue(objectId: string, prop: string): number {
    // Zero pour une propriete inconnue : le contrat du panneau exige un nombre,
    // et une liaison absente n'a de toute facon rien a poser.
    return this._bindings[objectId]?.[prop]?.get() ?? 0;
  }

  /**
   * Tout ce que le theatre SAIT animer, keyframe ou non.
   *
   * `tracksOf` ne rend que les pistes deja creees : sans ce rappel, une
   * propriete n'apparait dans le panneau qu'une fois animee — et on ne peut
   * donc jamais y poser sa PREMIERE cle. C'est ce qui donnait une timeline
   * vide malgre des bindings declares.
   *
   * Le panneau de SONDE le fusionne avec les pistes existantes
   * (`mergeRows`) pour composer sa liste deroulante.
   */
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
    return this._markers;
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
    return { id: this.id, duration: this.duration, markers: this._markers, tracks: this._tracks };
  }

  /**
   * Symetrique de `snapshot()` : c'est ce qui rend l'annulation possible cote
   * panneau. Seules les PISTES reviennent — l'id et la duree sont poses a la
   * construction, et un etat qui pretendrait les changer decrirait un autre
   * theatre que celui qu'on edite.
   *
   * Les keyframes sont recopiees : l'appelant garde son etat pour le refaire,
   * et le partager le ferait muter par la premiere edition qui suit.
   */
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

  /**
   * Une piste VIDE pour chaque scalaire pilotable, meme sans keyframe : le
   * panneau liste ce que le theatre declare, et une propriete absente de
   * `tracksOf` ne peut jamais recevoir sa premiere clé.
   */
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

/**
 * Lecture defensive de l'etat rendu par `snapshot()`. Il transite par `unknown`
 * — c'est le type du contrat cote panneau — et un etat mal forme doit laisser
 * le theatre intact plutot que de vider ses pistes.
 */
function readTracks(state: unknown): Record<string, Record<string, TimelineTrack>> | null {
  if (typeof state !== "object" || state === null) return null;
  const tracks = (state as { tracks?: unknown }).tracks;
  if (typeof tracks !== "object" || tracks === null) return null;
  return tracks as Record<string, Record<string, TimelineTrack>>;
}

/**
 * Maintien avant la premiere et apres la derniere keyframe : une piste ne
 * s'annule pas hors de son intervalle, elle tient sa valeur de bord. Sans ca,
 * scrubber avant le premier keyframe remettrait la propriete a zero.
 */
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
    // Deux keyframes au meme temps : pas d'intervalle a interpoler, la seconde
    // gagne. C'est le cas d'une coupure franche, volontaire.
    if (span <= 1e-6) return b.v;
    // Ease SORTANT : c'est le keyframe de depart qui gouverne le segment qui le
    // suit. C'est la convention du panneau — il etiquette le segment `a -> b`
    // avec `a.e` et desactive l'editeur sur le dernier keyframe, qui n'ouvre
    // aucun segment. Lire `b.e` decalait tout d'un cran : regler un ease
    // agissait sur le segment PRECEDENT, et le seul keyframe pilotant le
    // segment final etait justement celui qu'on ne pouvait pas editer.
    return a.v + (b.v - a.v) * sampleEase(a.e, (t - a.t) / span, a.cp);
  }
  return last.v;
}
