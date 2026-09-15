import type { WebGLRenderer } from "three";

type StatsGl = {
  dom: HTMLElement;
  init: (gl: WebGLRenderingContext | WebGL2RenderingContext) => void;
  begin: () => void;
  end: () => void;
  update: () => void;
  destroy?: () => void;
};

type ThreePerfInstance = {
  enabled: boolean;
  begin: () => void;
  end: () => void;
  dispose: () => void;
};

export class StatsManager {
  private readonly _renderer: WebGLRenderer;
  private _basicStats: StatsGl | null = null;
  private _threePerf: ThreePerfInstance | null = null;
  private _threePerfHost: HTMLDivElement | null = null;
  /**
   * ETEINT PAR DEFAUT, et c'est un defaut, pas un verrou. Actif d'office, il
   * affichait images par seconde, CPU et GPU a tout visiteur de la production.
   * Il s'allume par `?stats` dans l'URL, ou depuis Render -> Stats.
   */
  private _basicEnabled = false;
  private _perfEnabled = false;
  private _isInitializingBasic = false;
  private _isInitializingPerf = false;

  constructor(renderer: WebGLRenderer) {
    this._renderer = renderer;
  }

  get basicEnabled(): boolean {
    return this._basicEnabled;
  }

  get perfEnabled(): boolean {
    return this._perfEnabled;
  }

  async setBasicEnabled(enabled: boolean): Promise<void> {
    this._basicEnabled = enabled;

    if (enabled && !this._basicStats && !this._isInitializingBasic) {
      this._isInitializingBasic = true;
      await this._createBasicStats();
      this._isInitializingBasic = false;
    }

    if (this._basicStats) {
      this._basicStats.dom.style.display = enabled ? "block" : "none";
    }
  }

  async setPerfEnabled(enabled: boolean): Promise<void> {
    this._perfEnabled = enabled;

    if (enabled && !this._threePerf && !this._isInitializingPerf) {
      this._isInitializingPerf = true;
      await this._createPerfStats();
      this._isInitializingPerf = false;
    }

    if (this._threePerfHost) {
      this._threePerfHost.style.display = enabled ? "block" : "none";
    }
    if (this._threePerf) {
      this._threePerf.enabled = enabled;
    }
  }

  async toggleBasic(): Promise<boolean> {
    const next = !this._basicEnabled;
    await this.setBasicEnabled(next);
    return next;
  }

  async togglePerf(): Promise<boolean> {
    const next = !this._perfEnabled;
    await this.setPerfEnabled(next);
    return next;
  }

  async enable(): Promise<void> {
    await Promise.all([this.setBasicEnabled(true), this.setPerfEnabled(true)]);
  }

  disable(): void {
    this._basicEnabled = false;
    this._perfEnabled = false;
    if (this._basicStats) {
      this._basicStats.dom.style.display = "none";
    }
    if (this._threePerfHost) {
      this._threePerfHost.style.display = "none";
    }
    if (this._threePerf) {
      this._threePerf.enabled = false;
    }
  }

  async toggle(): Promise<boolean> {
    if (this._basicEnabled || this._perfEnabled) {
      this.disable();
      return false;
    }
    await this.enable();
    return true;
  }

  begin(): void {
    if (this._basicEnabled && this._basicStats) {
      this._basicStats.begin();
    }
    if (this._perfEnabled) {
      this._threePerf?.begin();
    }
  }

  end(): void {
    if (this._basicEnabled && this._basicStats) {
      this._basicStats.end();
    }
    if (this._perfEnabled) {
      this._threePerf?.end();
    }
  }

  update(): void {
    if (!this._basicEnabled || !this._basicStats) return;
    this._basicStats.update();
  }

  dispose(): void {
    this._basicEnabled = false;
    this._perfEnabled = false;
    if (this._basicStats) {
      this._basicStats.destroy?.();
      this._basicStats.dom.remove();
      this._basicStats = null;
    }
    if (this._threePerf) {
      this._threePerf.dispose();
      this._threePerf = null;
    }
    if (this._threePerfHost) {
      this._threePerfHost.remove();
      this._threePerfHost = null;
    }
  }

  private async _createBasicStats(): Promise<void> {
    const statsModule = await import("stats-gl");
    const StatsCtor = statsModule.default as unknown as new (params?: unknown) => StatsGl;
    const stats = new StatsCtor({
      trackGPU: true,
      trackHz: false,
      trackCPT: false,
      logsPerSecond: 4,
      graphsPerSecond: 30,
      minimal: false,
      mode: 0,
    });
    this._patchPerformanceMarkers(stats);

    stats.init(this._renderer.getContext());
    stats.dom.style.position = "fixed";
    stats.dom.style.left = "10px";
    stats.dom.style.bottom = "10px";
    stats.dom.style.zIndex = "10001";
    stats.dom.style.display = this._basicEnabled ? "block" : "none";
    document.body.appendChild(stats.dom);

    this._basicStats = stats;
  }

  private async _createPerfStats(): Promise<void> {
    const perfModule = await import("three-perf");
    const ThreePerfCtor = perfModule.ThreePerf as new (params: {
      renderer: WebGLRenderer;
      domElement: HTMLElement;
      anchorX?: "left" | "right";
      anchorY?: "top" | "bottom";
      showGraph?: boolean;
    }) => ThreePerfInstance;

    const host = document.createElement("div");
    host.style.position = "fixed";
    host.style.right = "10px";
    host.style.bottom = "10px";
    host.style.zIndex = "10001";
    host.style.display = this._perfEnabled ? "block" : "none";
    document.body.appendChild(host);

    const threePerf = new ThreePerfCtor({
      renderer: this._renderer,
      domElement: host,
      anchorX: "right",
      anchorY: "bottom",
      showGraph: true,
    });
    threePerf.enabled = this._perfEnabled;

    this._threePerf = threePerf;
    this._threePerfHost = host;
  }

  private _patchPerformanceMarkers(stats: StatsGl): void {
    const statsAny = stats as any;
    const prefix = "stats-gl-";
    const originalBegin = statsAny.beginProfiling?.bind(statsAny);
    const originalEnd = statsAny.endProfiling?.bind(statsAny);
    const withPrefix = (value: string) =>
      value.startsWith(prefix) ? value : `${prefix}${value}`;

    if (typeof originalBegin === "function") {
      statsAny.beginProfiling = (marker: string) => {
        return originalBegin(withPrefix(marker));
      };
    }

    if (typeof originalEnd === "function") {
      statsAny.endProfiling = (
        startMarker: string | PerformanceMeasureOptions | undefined,
        endMarker: string | undefined,
        measureName: string
      ) => {
        const start = typeof startMarker === "string" ? withPrefix(startMarker) : startMarker;
        const end = typeof endMarker === "string" ? withPrefix(endMarker) : endMarker;
        const measure = withPrefix(measureName);
        return originalEnd(start, end, measure);
      };
    }
  }
}
