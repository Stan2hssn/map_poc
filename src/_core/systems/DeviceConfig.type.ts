import type { ShadowMapType } from "three";
import type { DebugPersistence } from "../debug/DebugValues.ts";
import type { RendererBackend } from "./Renderer.type.ts";
import type ThreeDevice from "./ThreeDevice.ts";

/**
 * Ce qu'un projet ajoute au device SANS modifier le core.
 *
 * Fourni par `src/graphics/device/device.config.ts` (`DEVICE_CONFIG`). Tout ce
 * qui etait propre a un projet dans `ThreeDevice` ou `Output` — panneaux de
 * reglage du post-traitement, inclinaison, LUT, plafond de pixel ratio — passe
 * par ici, et le `_core` reste identique d'un projet a l'autre.
 */
export interface DeviceConfig {
  readonly renderer?: DeviceRendererConfig;
  /**
   * Transport des reglages du panneau (fichier relu, ecriture de developpement).
   * Absent : les bindings persistants se comportent comme des bindings simples.
   */
  readonly debugPersistence?: DebugPersistence;
  /**
   * Apres le prechargement du groupe `boot`, avant l'initialisation du debug et
   * l'activation du premier univers. Pour brancher sur le device ce qui vient
   * des assets de boot (textures de LUT, par exemple).
   */
  onBoot?(device: ThreeDevice): void;
  /**
   * Reglages de debug propres au projet. Appele une fois, panneau ouvert ou non :
   * les `debug.bind(null, …)` y appliquent les valeurs enregistrees. Rend les
   * desabonnements, liberes au `dispose` du device.
   */
  bindDebug?(device: ThreeDevice): (() => void)[];
}

export interface DeviceRendererConfig {
  /**
   * Defaut `webgl`. `webgpu` exige une chaine de post-traitement TSL
   * (`graphics/postprocessing/webgpu`) et des materiaux node, pas de GLSL.
   */
  readonly backend?: RendererBackend;
  /** Plafond du pixel ratio. Defaut 2. */
  readonly maxPixelRatio?: number;
  /**
   * Plafond quand le pointeur est grossier (tactile). Le seul signal fiable
   * d'un telephone : la largeur ne distingue pas un mobile d'une fenetre etroite.
   * Defaut : `maxPixelRatio`.
   */
  readonly maxPixelRatioCoarse?: number;
  /**
   * Type de carte d'ombres, ou `false` pour la couper. Defaut `PCFSoftShadowMap` :
   * sans carte, les `castShadow` sont inertes sans le moindre avertissement.
   */
  readonly shadowMap?: ShadowMapType | false;
  /**
   * Exposition lue par le renderer, relue a CHAQUE image. Un getter permet de
   * la regler en direct quand le tone mapping vit dans le post-traitement.
   * Defaut 1.
   */
  readonly toneMappingExposure?: number;
}
