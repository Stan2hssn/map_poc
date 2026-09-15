export const EventMouse = {
  MOVE: "mousemove",
  DOWN: "mousedown",
  UP: "mouseup",
  CLICK: "click",
  WHEEL: "wheel",
} as const;

export type EventMouse = (typeof EventMouse)[keyof typeof EventMouse];

export const EventMouseButton = {
  LEFT: "left",
  MIDDLE: "middle",
  RIGHT: "right",
} as const;

export type EventMouseButton = (typeof EventMouseButton)[keyof typeof EventMouseButton];

export const EventKeyboard = {
  DOWN: "keydown",
  UP: "keyup",

  A: "KeyA",
  B: "KeyB",
  C: "KeyC",
  D: "KeyD",
  E: "KeyE",
  F: "KeyF",
  G: "KeyG",
  H: "KeyH",
  I: "KeyI",
  J: "KeyJ",
  K: "KeyK",
  L: "KeyL",
  M: "KeyM",
  N: "KeyN",
  O: "KeyO",
  P: "KeyP",
  Q: "KeyQ",
  R: "KeyR",
  S: "KeyS",
  T: "KeyT",
  U: "KeyU",
  V: "KeyV",
  W: "KeyW",
  X: "KeyX",
  Y: "KeyY",
  Z: "KeyZ",

  SHIFT: "shiftKey",
  CTRL: "ctrlKey",
  ALT: "altKey",
  META: "metaKey",
} as const;

export type EventKeyboard = (typeof EventKeyboard)[keyof typeof EventKeyboard];


export const EventInput = {
  ...EventMouse,
  ...EventKeyboard,
} as const;

export type EventInput = (typeof EventInput)[keyof typeof EventInput];