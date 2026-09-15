import type { ILifecycle } from "../lifecycle/ILifecycle.type.ts";

export default interface INode extends ILifecycle {
    readonly id: string;
    readonly name: string;
    readonly active: boolean;
    readonly mounted: boolean;

    beforeMount(): void | Promise<void>;
    onMounted(): void;
    beforeUnmount(): void | Promise<void>;
    onUnmounted(): void;

    update(time: number, dt: number): void;
    resize?(width: number, height: number): void;
    dispose(): void;
}
