import type { WebGLRenderer, WebGLRendererParameters } from "three";
import type { WebGPURenderer } from "three/webgpu";

export type RendererBackend = "webgl" | "webgpu";

/** `webgpu` : WebGPURenderer, qui bascule seul sur WebGL2 si WebGPU manque. */
export type Renderer = WebGLRenderer | WebGPURenderer;

export type RendererParameters = WebGLRendererParameters & ConstructorParameters<typeof WebGPURenderer>[0];
