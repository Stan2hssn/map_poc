/**
 * Lifecycle - Contract for mount/unmount. Not part of _core universe loop.
 */

export interface ILifecycle {
  onBeforeMounted?(): void | Promise<void>;
  onMounted?(): void;
  onBeforeUnmount?(): void | Promise<void>;
  onUnmounted?(): void;
}
