const STORAGE_KEY = "map:scene-scale";
/** Ancienne qualite dynamique : densite de pixels retenue d'une visite a l'autre, a oublier. */
const LEGACY_KEY = "map:pixel-ratio";
/** Echelle de la scene : de 1 a `MIN_SCALE`, par pas de `STEP`. */
const STEP = 0.1;
const MIN_SCALE = 0.6;
const WINDOW_MS = 1000;
// Les premieres secondes (compilation des shaders, chargement) ne comptent pas.
const WARMUP_MS = 3000;
// Au-dela, l'image manquee est une pause (onglet cache), pas une lenteur.
const PAUSE_MS = 250;
/** Trop lent : moyenne au-dela de la periode d'affichage x `SLOW`, `SLOW_WINDOWS` fenetres de suite. */
const SLOW = 1.12;
const SLOW_WINDOWS = 2;
/** A l'aise : sous la periode x `EASY` pendant `EASY_WINDOWS` fenetres, on essaie un cran au-dessus. */
const EASY = 1.03;
const EASY_WINDOWS = 6;
/** Un essai rate bloque la remontee ce temps (ms). */
const RETRY_MS = 20000;
/** Frequences d'affichage courantes (Hz) : la periode mesuree s'aligne sur la plus proche. */
const RATES = [60, 75, 90, 100, 120, 144, 165, 240];

const stored = (): number | null => {
  try {
    localStorage.removeItem(LEGACY_KEY);
    const value = Number(localStorage.getItem(STORAGE_KEY));
    return value >= MIN_SCALE && value <= 1 ? value : null;
  } catch {
    return null;
  }
};

/**
 * Qualite dynamique : tenir la frequence de l'ecran (60, 120 Hz...) en rendant la scene, le plus cher, a une
 * echelle plus petite ; l'encre, les trames et le papier restent a pleine resolution. Baisse d'un cran quand la
 * cadence decroche, remonte a l'essai quand elle est a l'aise ; l'echelle atteinte est retenue pour la visite
 * suivante.
 */
export class DynamicQualityHelper {
  enabled = true;
  scale = 1;
  private readonly _onChange: (scale: number) => void;
  private _clock = 0;
  private _window = 0;
  private _frames = 0;
  private _slow = 0;
  private _easy = 0;
  /** Periode d'affichage (ms), mesuree apres le demarrage. */
  private _period = 0;
  private readonly _warmup: number[] = [];
  /** Remontee a l'essai en cours, et date avant laquelle ne pas reessayer. */
  private _trial = false;
  private _blockedUntil = 0;

  constructor(onChange: (scale: number) => void) {
    this._onChange = onChange;
    const scale = stored();
    if (scale) this._set(scale, false);
  }

  update(dt: number): void {
    this._clock += dt;
    if (!this.enabled || dt > PAUSE_MS || document.visibilityState !== "visible") return;
    if (this._clock < WARMUP_MS) {
      this._warmup.push(dt);
      return;
    }
    if (!this._period) this._period = periodOf(this._warmup);
    this._window += dt;
    this._frames++;
    if (this._window < WINDOW_MS) return;
    const average = this._window / this._frames;
    this._window = this._frames = 0;
    this._slow = average > this._period * SLOW ? this._slow + 1 : 0;
    this._easy = average < this._period * EASY ? this._easy + 1 : 0;
    if (this._slow >= SLOW_WINDOWS && this.scale > MIN_SCALE) {
      if (this._trial) this._blockedUntil = this._clock + RETRY_MS;
      this._trial = false;
      this._set(this.scale - STEP);
    } else if (this._easy >= EASY_WINDOWS) {
      this._trial = false;
      if (this.scale < 1 && this._clock > this._blockedUntil) {
        this._trial = true;
        this._set(this.scale + STEP);
      }
    }
  }

  private _set(scale: number, remember = true): void {
    this.scale = Math.round(Math.min(1, Math.max(MIN_SCALE, scale)) * 100) / 100;
    this._slow = this._easy = 0;
    if (remember) {
      try {
        localStorage.setItem(STORAGE_KEY, String(this.scale));
      } catch {
        // Stockage indisponible : l'echelle vaut pour cette visite seulement.
      }
    }
    this._onChange(this.scale);
  }
}

/** Periode d'affichage : le decile le plus rapide des images, aligne sur la frequence courante la plus proche. */
function periodOf(intervals: number[]): number {
  const sorted = [...intervals].sort((a, b) => a - b);
  const fast = sorted[Math.floor(sorted.length * 0.1)] ?? 1000 / 60;
  const rate = RATES.reduce((best, r) => (Math.abs(1000 / r - fast) < Math.abs(1000 / best - fast) ? r : best), 60);
  return 1000 / rate;
}
