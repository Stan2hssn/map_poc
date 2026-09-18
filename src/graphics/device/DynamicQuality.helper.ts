import type { WebGPURenderer } from "three/webgpu";

const STORAGE_KEY = "map:pixel-ratio";
/** Au-dela (ms par image, en moyenne sur une fenetre), la cadence est trop basse. */
const SLOW_MS = 1000 / 45;
const WINDOW_MS = 1500;
/** Fenetres lentes de suite avant de baisser : un pic de chargement ne suffit pas. */
const SLOW_WINDOWS = 2;
const STEP = 0.25;
const MIN_RATIO = 1;
// Les premieres secondes (compilation des shaders, chargement) ne comptent pas.
const WARMUP_MS = 4000;
// Au-dela, l'image manquee est une pause (onglet cache), pas une lenteur.
const PAUSE_MS = 250;

const stored = (): number | null => {
  try {
    const value = Number(localStorage.getItem(STORAGE_KEY));
    return value > 0 ? value : null;
  } catch {
    return null;
  }
};

/**
 * Qualite dynamique, comme Chartogne-Taillet : si la cadence tombe, la densite de pixels baisse d'un cran
 * (la parallaxe coute par pixel) ; le niveau atteint est retenu pour la visite suivante.
 */
export class DynamicQualityHelper {
  enabled = true;
  private readonly _renderer: WebGPURenderer;
  private readonly _onChange: (ratio: number) => void;
  private _clock = 0;
  private _window = 0;
  private _frames = 0;
  private _slow = 0;

  constructor(renderer: WebGPURenderer, onChange: (ratio: number) => void) {
    this._renderer = renderer;
    this._onChange = onChange;
    const level = stored();
    if (level && level < renderer.getPixelRatio()) this._set(level);
  }

  /** Niveau choisi a la main : il remplace celui retenu, et la qualite dynamique repart de la. */
  choose(ratio: number): void {
    this._renderer.setPixelRatio(ratio);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Stockage indisponible (navigation privee) : rien a oublier.
    }
  }

  update(dt: number): void {
    this._clock += dt;
    if (!this.enabled || this._clock < WARMUP_MS || dt > PAUSE_MS || document.visibilityState !== "visible") return;
    this._window += dt;
    this._frames++;
    if (this._window < WINDOW_MS) return;
    const average = this._window / this._frames;
    this._window = this._frames = 0;
    this._slow = average > SLOW_MS ? this._slow + 1 : 0;
    if (this._slow < SLOW_WINDOWS) return;
    this._slow = 0;
    const next = this._renderer.getPixelRatio() - STEP;
    if (next >= MIN_RATIO) this._set(next);
  }

  private _set(ratio: number): void {
    this._renderer.setPixelRatio(ratio);
    try {
      localStorage.setItem(STORAGE_KEY, String(ratio));
    } catch {
      // Stockage indisponible : le niveau vaut pour cette visite seulement.
    }
    this._onChange(ratio);
  }
}
