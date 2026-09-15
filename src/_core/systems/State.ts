/**
 * State (mémoire) - État partagé du _core
 * Viewport, infos navigateur, etc.
 */

export interface Viewport {
  width: number;
  height: number;
  dpr: number;
}

export interface StateSnapshot {
  viewport: Viewport;
  browser: string;
}

export default class State {
  private readonly _viewport: Viewport = {
    width: 0,
    height: 0,
    dpr: typeof globalThis.window === "undefined" ? 1 : Math.min(globalThis.window.devicePixelRatio, 2),
  };

  private _browser: string = "";

  constructor() {
    if (typeof globalThis.navigator !== "undefined") {
      this._browser = globalThis.navigator.userAgent;
    }
  }

  get viewport(): Viewport {
    return { ...this._viewport };
  }

  get browser(): string {
    return this._browser;
  }

  setViewport(width: number, height: number, dpr?: number): void {
    this._viewport.width = width;
    this._viewport.height = height;
    if (dpr !== undefined) this._viewport.dpr = dpr;
  }

  getSnapshot(): StateSnapshot {
    return {
      viewport: this.viewport,
      browser: this._browser,
    };
  }
}
