import type Input from "@_core/systems/Input.ts";
import { EventKeyboard, EventMouse, EventMouseButton } from "@_core/helpers/event/Input.events.ts";

const DOM_BUTTON_TO_EVENT: Record<number, "left" | "middle" | "right"> = {
  0: EventMouseButton.LEFT,
  1: EventMouseButton.MIDDLE,
  2: EventMouseButton.RIGHT,
};

export class DOMInputAdapter {
  private _canvas: HTMLCanvasElement | null = null;
  private _input: Input | null = null;
  private _onMouseMove: ((event: MouseEvent) => void) | null = null;
  private _onMouseDown: ((event: MouseEvent) => void) | null = null;
  private _onMouseUp: ((event: MouseEvent) => void) | null = null;
  private _onWheel: ((event: WheelEvent) => void) | null = null;
  private _onKeyDown: ((event: KeyboardEvent) => void) | null = null;
  private _onKeyUp: ((event: KeyboardEvent) => void) | null = null;

  attach(canvas: HTMLCanvasElement, input: Input): void {
    this.detach();
    this._canvas = canvas;
    this._input = input;

    this._onMouseMove = (event: MouseEvent) => {
      if (!this._input) return;
      this._syncMouseFromEvent(event);
      this._input.emitMouseMove(event);
    };

    this._onMouseDown = (event: MouseEvent) => {
      if (!this._input) return;
      this._syncMouseFromEvent(event);
      const button = DOM_BUTTON_TO_EVENT[event.button] ?? EventMouseButton.LEFT;
      this._input.setMouseButton(button, true, event);
    };

    this._onMouseUp = (event: MouseEvent) => {
      if (!this._input) return;
      this._syncMouseFromEvent(event);
      const button = DOM_BUTTON_TO_EVENT[event.button] ?? EventMouseButton.LEFT;
      this._input.setMouseButton(button, false, event);
    };

    this._onWheel = (event: WheelEvent) => {
      if (!this._input) return;
      this._input.setWheel(event.deltaY, event);
    };

    this._onKeyDown = (event: KeyboardEvent) => {
      if (!this._input) return;
      this._input.emitKeyDown(event);
    };

    this._onKeyUp = (event: KeyboardEvent) => {
      if (!this._input) return;
      this._input.emitKeyUp(event);
    };

    this._canvas.addEventListener(EventMouse.MOVE, this._onMouseMove);
    this._canvas.addEventListener(EventMouse.DOWN, this._onMouseDown);
    this._canvas.addEventListener(EventMouse.UP, this._onMouseUp);
    this._canvas.addEventListener(EventMouse.WHEEL, this._onWheel, { passive: true });
    globalThis.addEventListener(EventKeyboard.DOWN, this._onKeyDown, true);
    globalThis.addEventListener(EventKeyboard.UP, this._onKeyUp, true);
  }

  detach(): void {
    if (this._canvas && this._onMouseMove) {
      this._canvas.removeEventListener(EventMouse.MOVE, this._onMouseMove);
    }
    if (this._canvas && this._onMouseDown) {
      this._canvas.removeEventListener(EventMouse.DOWN, this._onMouseDown);
    }
    if (this._canvas && this._onMouseUp) {
      this._canvas.removeEventListener(EventMouse.UP, this._onMouseUp);
    }
    if (this._canvas && this._onWheel) {
      this._canvas.removeEventListener(EventMouse.WHEEL, this._onWheel);
    }
    if (this._onKeyDown) {
      globalThis.removeEventListener(EventKeyboard.DOWN, this._onKeyDown, true);
    }
    if (this._onKeyUp) {
      globalThis.removeEventListener(EventKeyboard.UP, this._onKeyUp, true);
    }

    this._onMouseMove = null;
    this._onMouseDown = null;
    this._onMouseUp = null;
    this._onWheel = null;
    this._onKeyDown = null;
    this._onKeyUp = null;
    this._canvas = null;
    this._input = null;
  }

  dispose(): void {
    this.detach();
  }

  private _syncMouseFromEvent(event: MouseEvent): void {
    if (!this._canvas || !this._input) return;
    const width = this._canvas.clientWidth || globalThis.window?.innerWidth || 1;
    const height = this._canvas.clientHeight || globalThis.window?.innerHeight || 1;
    const x = event.clientX;
    const y = event.clientY;
    const nx = (x / width) * 2 - 1;
    const ny = -(y / height) * 2 + 1;
    this._input.setMousePosition({ x, y, nx, ny, sourceEvent: event });
  }
}
