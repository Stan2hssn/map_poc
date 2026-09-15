import type { FrameTiming } from "../types/Frame.type.ts";
import type IPass from "./Pass.interface.ts";
import type { PassContext } from "./Pass.interface.ts";
import type IPipeline from "./Pipeline.interface.ts";

export class PipelineBase implements IPipeline {
    protected readonly _passes: IPass[];

    constructor(passes: IPass[] = []) {
        this._passes = [...passes];
    }

    async beforeMount(): Promise<void> {
        await Promise.all(this._passes.map((p) => p.beforeMount()));
    }

    onMounted(): void {
        for (const p of this._passes) p.onMounted();
    }

    async beforeUnmount(): Promise<void> {
        await Promise.all(this._passes.map((p) => p.beforeUnmount()));
    }

    onUnmounted(): void {
        for (const p of this._passes) p.onUnmounted();
    }

    prepare(frame: FrameTiming, ctx: PassContext): void {
        for (const p of this._passes) p.prepare?.(frame, ctx);
    }

    render(frame: FrameTiming, ctx: PassContext): void {
        for (const p of this._passes) p.render(frame, ctx);
    }

    resize(width: number, height: number): void {
        for (const p of this._passes) p.resize(width, height);
    }

    dispose(): void {
        for (const p of this._passes) p.dispose();
    }
}
