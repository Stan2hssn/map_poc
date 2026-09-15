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
    private _startTime = 0;
    private _initialized = false;
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
        this._startTime = performance.now();
        this._lastTime = this._startTime;
        this._time = 0;
        this._tick();
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
        const dt = currentTime - this._lastTime;
        this._lastTime = currentTime;
        this._time = currentTime - this._startTime;

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
