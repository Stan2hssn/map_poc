import type { FrameTiming } from "@_core/types/Frame.type.ts";
import type { Matrix4, Vector2 } from "three";
import type { Node, TextureNode, UniformNode } from "three/webgpu";

export interface EffectContext {
  /** Coordonnees ecran du fragment. */
  uv: Node;
  /** Image d'entree de la passe, pour lire des voisins : `inputBuffer.sample(uv)`. */
  inputBuffer: TextureNode;
  /** Taille du buffer, en pixels. */
  resolution: UniformNode<Vector2>;
  /** Normales (vue, codees 0..1) et profondeur de la scene : `EffectComposer` avec `normalDepth`, sinon vides. */
  normalBuffer: TextureNode;
  depthBuffer: TextureNode;
  /** Plans proche et lointain de la camera, pour lineariser la profondeur. */
  cameraNear: UniformNode<number>;
  cameraFar: UniformNode<number>;
  /** Projection inverse et matrice monde de la camera : position d'un pixel dans la scene. */
  cameraProjectionInverse: UniformNode<Matrix4>;
  cameraWorld: UniformNode<Matrix4>;
}

/**
 * Un effet = une fonction TSL de la couleur, et ses uniforms (reglables sans recompiler).
 *
 * Les effets d'une `EffectPass` forment un seul shader : `inputBuffer` y reste l'image d'entree
 * de la passe. Un effet qui lit des voisins va donc en tete de sa passe.
 */
export default interface IEffect {
  /** Couleur lineaire (vec4) en entree, couleur suivante en sortie. */
  color(input: Node, ctx: EffectContext): Node;
  update?(frame: FrameTiming): void;
  setSize?(width: number, height: number): void;
  dispose?(): void;
}
