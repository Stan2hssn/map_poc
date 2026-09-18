# Post-traitement

Incubation de la future `_lib/postprocessing`. TSL, `WebGPURenderer` seulement (WebGPU et son repli WebGL2). Conception reprise de [pmndrs/postprocessing](https://github.com/pmndrs/postprocessing), pas son code.

```ts
const pipeline = new EffectComposer([
  new RenderPass(),
  new EffectPass([grain, vignette]),
], { multisampling: 0 });
```

| Fichier | Rôle |
|---|---|
| `EffectComposer.ts` | Pipeline de l'univers. Buffers d'entrée et de sortie à la taille du canvas ; `render`, puis `postRender` avec échange des buffers ; dernière passe à l'écran. `normalDepth` : la scène écrit aussi normales et profondeur (`ctx.sceneBuffer`). |
| `passes/Pass.base.ts` | `PassBase` : triangle plein écran (`QuadMesh`), `renderToScreen`, `needsSwap`, `setSize`. |
| `passes/RenderPass.ts` | Scène → `inputBuffer` ; normales en seconde sortie (`mrt`) si le buffer en a deux. |
| `passes/EffectPass.ts` | Effets enchaînés dans un seul matériau. Sans effet : copie. |
| `effects/Effect.interface.ts` | `IEffect`, `EffectContext` (image d'entrée, résolution, normales, profondeur, plans de la caméra). |
| `effects/Ink.effect.ts` | Encre sur papier : contours (profondeur, arêtes), hachures ou trame, trait qui tremble, bavure, grain. |

## Écrire un effet

Une fonction TSL de la couleur, et ses uniforms. Fichier `effects/Nom.effect.ts`.

```ts
export class VignetteEffect implements IEffect {
  readonly strength = uniform(0.3);

  color(input: Node, { uv }: EffectContext): Node {
    const edge = smoothstep(0.3, 1, uv.sub(0.5).length().mul(2));
    return vec4(input.rgb.mul(edge.mul(this.strength).oneMinus()), input.a);
  }
}
```

- Couleur linéaire en entrée comme en sortie : seule la dernière passe encode en sRGB.
- Tout réglage passe par un uniform (`debug.bind` sur `.value`) : rien à recompiler.
- Dans une `EffectPass`, `inputBuffer` reste l'image d'entrée de la passe. Un effet qui lit des voisins (`inputBuffer.sample(uv)`) va donc en tête.
- Un effet à plusieurs rendus (flou, bloom) : sa propre passe, ou un nœud de `three/addons/tsl/display/`.
- Ne jamais vider le canvas à part : en WebGPU, c'est une passe plein écran de plus.

## Extraction

Vers `_lib/postprocessing` quand un deuxième projet en a besoin. Dépend aujourd'hui du `_core` (`IPass`, `PipelineBase`, `FrameTiming`) : à remplacer à ce moment-là par des interfaces propres à la lib.
