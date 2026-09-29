import type InputBase from "./Input.ts";
import type Output from "./Output.ts";
import type { StatsManager } from "../stats/index.ts";

/**
 * RAF - Main loop.
 * tick: time/dt → input.update → output.update → output.render.
 */
export default class RAF {
    private readonly _input: InputBase;
    private readonly _output: Output;

    private _isRunning = false;
    private _rafId: number | null = null;
    private _time = 0;
    private _lastTime = 0;
    private _initialized = false;
    /**
     * Cadence du temps de scene. 1 = temps reel.
     *
     * Ici et nulle part ailleurs : c'est le seul endroit ou le temps nait, donc
     * le seul ou le ralentir garde la scene coherente. Ralentir une seule
     * animation — la timeline par exemple — la ferait avancer au ralenti pendant
     * que le uTime des shaders, le bruit et la physique garderaient leur
     * cadence, et on reglerait cette animation sur une image que personne ne
     * verra jamais a vitesse normale.
     */
    private _rate = 1;
    private _stats: StatsManager | null = null;

    constructor(input: InputBase, output: Output) {
        this._input = input;
        this._output = output;
    }

    get input(): InputBase {
        return this._input;
    }

    get output(): Output {
        return this._output;
    }

    get initialized(): boolean {
        return this._initialized;
    }

    get isRunning(): boolean {
        return this._isRunning;
    }

    get time(): number {
        return this._time;
    }

    setStats(stats: StatsManager | null): void {
        this._stats = stats;
    }

    init(): void {
        if (this._initialized) {
            console.warn("RAF already initialized");
            return;
        }
        this._initialized = true;
    }

    start(): void {
        if (!this._initialized) {
            throw new Error("RAF must be initialized before starting");
        }
        if (this._isRunning) {
            console.warn("RAF is already running");
            return;
        }
        this._isRunning = true;
        this._lastTime = performance.now();
        this._time = 0;
        this._tick();
    }

    /**
     * Regle la cadence du temps de scene. Zero fige sans arreter la boucle : le
     * rendu continue, donc l'outillage et les interactions repondent encore.
     */
    setRate(rate: number): void {
        this._rate = Number.isFinite(rate) && rate >= 0 ? rate : 1;
    }

    rate(): number {
        return this._rate;
    }

    stop(): void {
        if (!this._isRunning) return;
        this._isRunning = false;
        if (this._rafId !== null) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }
    }

    private readonly _tick = (): void => {
        if (!this._isRunning) return;

        const currentTime = performance.now();
        const dt = (currentTime - this._lastTime) * this._rate;
        this._lastTime = currentTime;
        // Accumule et non lu sur l'horloge murale : sinon `time` et `dt`
        // divergeraient des que la cadence n'est plus 1, et tout ce qui se cale
        // sur `time` plutot que sur `dt` garderait le temps reel.
        this._time += dt;

        this._input.update(this._time, dt);
        this._stats?.begin();
        this._output.update(this._time, dt);
        this._output.render({ time: this._time, deltaTime: dt });
        this._stats?.end();
        this._stats?.update();

        this._rafId = requestAnimationFrame(this._tick);
    };

    resize(width: number, height: number): void {
        this._output.resize(width, height);
    }

    dispose(): void {
        this.stop();
        this._initialized = false;
    }
}
