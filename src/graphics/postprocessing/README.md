# Post-traitement

Incubation de la future `_lib/postprocessing`. TSL, `WebGPURenderer` seulement (WebGPU et son repli WebGL2). Conception reprise de [pmndrs/postprocessing](https://github.com/pmndrs/postprocessing), pas son code.

```ts
const ink = new InkEffect({ anchorAt: inkAnchorAt });
const composer = new EffectComposer(
  [
    new RenderPass(),
    new EffectPass([ink]),
    new OverlayPass(() => labels.scene),
    new OverlayPass(() => panel.scene),
    new OverlayPass(() => intro.scene),
  ],
  { normalDepth: true },
);
```

| Fichier | Rôle |
|---|---|
| `EffectComposer.ts` | Pipeline de l'univers. Entrée (la scène) à `sceneScale` × canvas, sortie et tampon d'échange à pleine taille ; `render`, puis `postRender` avec échange des buffers ; la dernière passe active hors `overlay` rend à l'écran. `normalDepth` : la scène écrit aussi normales et profondeur (`ctx.sceneBuffer`). `compile` précompile toute la chaîne ; `paused` garde l'image précédente. |
| `passes/Pass.base.ts` | `PassBase` : triangle plein écran (`QuadMesh`), `renderToScreen`, `needsSwap`, `overlay`, `setSize`, `compile`. |
| `passes/RenderPass.ts` | Scène → `inputBuffer` ; normales en seconde sortie (`mrt`) si le buffer en a deux. |
| `passes/EffectPass.ts` | Effets enchaînés dans un seul matériau. Sans effet : copie. Reconstruit seulement quand `renderToScreen` change (encodage sRGB). |
| `effects/Effect.interface.ts` | `IEffect`, `EffectContext` (image d'entrée, résolution, normales, profondeur, plans de la caméra). |
| `passes/OverlayPass.ts` | Scène dessinée par-dessus l'image finie, à l'écran, sans l'effacer (interface) ; hors de la chaîne des tampons (`overlay`). |
| `effects/Ink.effect.ts` | Encre sur papier : contours (profondeur, arêtes), hachures ou trame, trait qui tremble, bavure, grain. Lit l'alpha des normales (`mrt`) : part dessinée (0 à 1), plus `HOVER_BAND` dans le lieu survolé et deux fois sur son périmètre ; négatif sur les volumes extrudés. |
| `effects/InkStyle.ts` | Réglages de l'encre (`inkSettings`), papier, journal, nuages, et les fonctions de trait partagées (`inkCoverage`, `inkOnPaper`, `paperAt`). |
| `effects/PageTransition.ts` | Page d'entrée posée sur la carte (`pageOver`) et masque de composition à l'écran qui la retire (`mapUncovered`, réglé par `pageTransition`). |

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

- Couleur linéaire en entrée comme en sortie : seule la dernière passe encode en sRGB. Une `OverlayPass` n'encode pas : ses matériaux écrivent des octets sRGB.
- Tout réglage passe par un uniform (`debug.bind` sur `.value`) : rien à recompiler.
- Dans une `EffectPass`, `inputBuffer` reste l'image d'entrée de la passe. Un effet qui lit des voisins (`inputBuffer.sample(uv)`) va donc en tête.
- Un effet à plusieurs rendus (flou, bloom) : sa propre passe, ou un nœud de `three/addons/tsl/display/`.
- Ne jamais vider le canvas à part : en WebGPU, c'est une passe plein écran de plus.

## Extraction

Vers `_lib/postprocessing` quand un deuxième projet en a besoin. Dépend aujourd'hui du `_core` (`IPass`, `PassContext`, `PipelineBase`, `FrameTiming`) : à remplacer à ce moment-là par des interfaces propres à la lib. L'encre dépend aussi du projet : `HOVER_BAND` (`Terrain.material.ts`) et le bruit peint (`NoiseMap.ts`, via `PageTransition`).

Détail du rendu, expliqué simplement : [`docs/dessin.md`](../../../docs/dessin.md).
