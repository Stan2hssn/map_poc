export interface InputMouseState {
  x: number;
  y: number;
  nx: number;
  ny: number;
  deltaX: number;
  deltaY: number;
  wheel: number;
  buttons: {
    left: boolean;
    middle: boolean;
    right: boolean;
  };
}

export interface InputSmoothMouseState {
  x: number;
  y: number;
  nx: number;
  ny: number;
}

export interface InputMouseMoveEvent {
  mouse: Readonly<InputMouseState>;
  smoothMouse: Readonly<InputSmoothMouseState>;
  mouseMoved: boolean;
  sourceEvent?: MouseEvent;
}

export interface InputWheelEvent {
  deltaY: number;
  mouse: Readonly<InputMouseState>;
  sourceEvent?: WheelEvent;
}

export interface InputKeyboardEvent {
  key: string;
  code: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  repeat: boolean;
  sourceEvent?: KeyboardEvent;
}

export type InputEventPayloadMap = {
  mousemove: InputMouseMoveEvent;
  mousedown: InputMouseMoveEvent;
  mouseup: InputMouseMoveEvent;
  wheel: InputWheelEvent;
  keydown: InputKeyboardEvent;
  keyup: InputKeyboardEvent;
};

type InputHandler<T> = (payload: T) => void;

/**
 * Input manager:
 * - stores current input state
 * - provides subscribe/unsubscribe event API
 * - can be fed by DOM adapter or external adapters
 */
export default class Input {
  private readonly _listeners = new Map<string, Set<(payload: unknown) => void>>();
  private readonly _mouse: InputMouseState = {
    x: 0,
    y: 0,
    nx: 0,
    ny: 0,
    deltaX: 0,
    deltaY: 0,
    wheel: 0,
    buttons: {
      left: false,
      middle: false,
      right: false,
    },
  };
  private readonly _smoothMouse: InputSmoothMouseState = {
    x: 0,
    y: 0,
    nx: 0,
    ny: 0,
  };
  private _mouseMoved = false;

  get mouse(): Readonly<InputMouseState> {
    return this._mouse;
  }

  get smoothMouse(): Readonly<InputSmoothMouseState> {
    return this._smoothMouse;
  }

  get mouseMoved(): boolean {
    return this._mouseMoved;
  }

  subscribe<K extends keyof InputEventPayloadMap>(
    eventType: K,
    handler: InputHandler<InputEventPayloadMap[K]>
  ): () => void {
    const key = eventType as string;
    if (!this._listeners.has(key)) {
      this._listeners.set(key, new Set());
    }

    const listeners = this._listeners.get(key)!;
    const wrapped = handler as (payload: unknown) => void;
    listeners.add(wrapped);

    return () => {
      listeners.delete(wrapped);
      if (listeners.size === 0) {
        this._listeners.delete(key);
      }
    };
  }

  emitExternal<K extends keyof InputEventPayloadMap>(
    eventType: K,
    payload: InputEventPayloadMap[K]
  ): void {
    this._emit(eventType as string, payload);
  }

  setMousePosition(payload: {
    x: number;
    y: number;
    nx: number;
    ny: number;
    sourceEvent?: MouseEvent;
  }): void {
    this._mouse.deltaX = payload.x - this._mouse.x;
    this._mouse.deltaY = payload.y - this._mouse.y;
    this._mouse.x = payload.x;
    this._mouse.y = payload.y;
    this._mouse.nx = payload.nx;
    this._mouse.ny = payload.ny;
  }

  setSmoothMousePosition(payload: {
    x: number;
    y: number;
    nx: number;
    ny: number;
  }): void {
    this._smoothMouse.x = payload.x;
    this._smoothMouse.y = payload.y;
    this._smoothMouse.nx = payload.nx;
    this._smoothMouse.ny = payload.ny;
  }

  setMouseMoved(mouseMoved: boolean): void {
    this._mouseMoved = mouseMoved;
  }

  emitMouseMove(sourceEvent?: MouseEvent): void {
    this._emit("mousemove", {
      mouse: this._mouse,
      smoothMouse: this._smoothMouse,
      mouseMoved: this._mouseMoved,
      sourceEvent,
    });
  }

  setMouseButton(
    button: "left" | "middle" | "right",
    pressed: boolean,
    sourceEvent?: MouseEvent
  ): void {
    this._mouse.buttons[button] = pressed;
    const eventType = pressed ? "mousedown" : "mouseup";
    this._emit(eventType, {
      mouse: this._mouse,
      smoothMouse: this._smoothMouse,
      mouseMoved: this._mouseMoved,
      sourceEvent,
    });
  }

  setWheel(deltaY: number, sourceEvent?: WheelEvent): void {
    this._mouse.wheel = deltaY;
    this._emit("wheel", {
      deltaY,
      mouse: this._mouse,
      sourceEvent,
    });
  }

  emitKeyDown(sourceEvent: KeyboardEvent): void {
    this._emit("keydown", {
      key: sourceEvent.key,
      code: sourceEvent.code,
      shiftKey: sourceEvent.shiftKey,
      ctrlKey: sourceEvent.ctrlKey,
      altKey: sourceEvent.altKey,
      metaKey: sourceEvent.metaKey,
      repeat: sourceEvent.repeat,
      sourceEvent,
    });
  }

  emitKeyUp(sourceEvent: KeyboardEvent): void {
    this._emit("keyup", {
      key: sourceEvent.key,
      code: sourceEvent.code,
      shiftKey: sourceEvent.shiftKey,
      ctrlKey: sourceEvent.ctrlKey,
      altKey: sourceEvent.altKey,
      metaKey: sourceEvent.metaKey,
      repeat: sourceEvent.repeat,
      sourceEvent,
    });
  }

  update(_time: number, _dt: number): void {
    this._mouse.deltaX = 0;
    this._mouse.deltaY = 0;
    this._mouse.wheel = 0;
  }

  dispose(): void {
    this._listeners.clear();
  }

  private _emit(eventType: string, payload: unknown): void {
    const listeners = this._listeners.get(eventType);
    if (!listeners) return;
    for (const listener of listeners) {
      listener(payload);
    }
  }

}
