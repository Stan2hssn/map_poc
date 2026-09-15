/**
 * Valeurs reglees a la main dans le panneau, et leur aller-retour avec un
 * fichier du projet.
 *
 * Sans elles, un reglage trouve apres vingt minutes disparait au rechargement,
 * et « Copy All Config » ne rend pas un etat relisible : les instantanes sont
 * une PROJECTION (couleurs en hexadecimal, compteurs en lecture seule), pas un
 * etat rejouable.
 *
 * Ce module porte l'etat REJOUABLE : un arbre de valeurs adressees par chemin
 * pointe, ecrit depuis les bindings eux-memes et relu avant leur creation. Le
 * transport (fichier, route de developpement) est fourni par le projet via
 * `DeviceConfig.debugPersistence`.
 */

export type DebugValues = Record<string, unknown>;

export interface DebugPersistence {
  /** Arbre relu au demarrage. Vide si rien n'a encore ete enregistre. */
  values: DebugValues;
  /** Absent hors developpement quand le fichier n'est ecrivable que par Vite. */
  persist?: (values: DebugValues) => void;
}

/** Objet qui sait recevoir une couleur depuis une chaine (`THREE.Color`). */
interface Colorable {
  getHexString(): string;
  set(value: string): unknown;
}

/** Objet a trois composantes (`THREE.Vector3`, et le point3d de Tweakpane). */
interface Vector3Like {
  x: number;
  y: number;
  z: number;
}

function isColorable(v: unknown): v is Colorable {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as Colorable).getHexString === "function" &&
    typeof (v as Colorable).set === "function"
  );
}

function isVector3Like(v: unknown): v is Vector3Like {
  if (typeof v !== "object" || v === null) return false;
  const c = v as Vector3Like;
  return typeof c.x === "number" && typeof c.y === "number" && typeof c.z === "number";
}

/**
 * Forme STOCKABLE d'une valeur de binding.
 *
 * `THREE.Color` et `THREE.Vector3` ne survivent pas a `JSON.stringify` — le
 * premier ressort en `{r,g,b}` que rien ne sait relire, le second traine ses
 * methodes. On les reduit a une chaine et a un triplet nus.
 */
export function serialize(value: unknown): unknown {
  if (isColorable(value)) return `#${value.getHexString()}`;
  if (isVector3Like(value)) return { x: value.x, y: value.y, z: value.z };
  return value;
}

/**
 * La valeur merite-t-elle d'etre conservee ?
 *
 * Un champ vide ou une saisie invalide fait emettre `null` a Tweakpane, et
 * `NaN` remonte de la meme facon. Ecrire l'un ou l'autre contamine le fichier :
 * au rechargement, la valeur est reposee telle quelle, et une amplitude a
 * `null` suffit a envoyer une camera en NaN — ecran noir, sans erreur.
 */
export function isStorable(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "number") return Number.isFinite(value);
  if (isVector3Like(value)) {
    return Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z);
  }
  return true;
}

/**
 * Repose une valeur relue sur sa cible vivante.
 *
 * On ecrit DANS l'objet existant quand il en porte un — remplacer un
 * `THREE.Color` par une chaine casserait le materiau qui le tient. Le type
 * courant decide, pas la forme du JSON.
 */
export function applyValue(target: Record<string, unknown>, key: string, raw: unknown): void {
  // Un fichier deja pollue ne doit pas casser la scene au demarrage : on laisse
  // la valeur du code en place.
  if (!isStorable(raw)) return;

  const current = target[key];

  if (typeof raw === "string" && isColorable(current)) {
    current.set(raw);
    return;
  }

  if (isVector3Like(raw) && isVector3Like(current)) {
    current.x = raw.x;
    current.y = raw.y;
    current.z = raw.z;
    return;
  }

  target[key] = raw;
}

/**
 * Arbre de valeurs adressees par chemin pointe (`fuzz.lengthMul`).
 *
 * L'ecriture est GROUPEE : un curseur tire produit des dizaines d'evenements
 * `change`, et chacun declencherait sinon une reecriture du fichier. On attend
 * que la main s'arrete.
 */
export class DebugValueStore {
  private _values: DebugValues = {};
  private _persist: ((values: DebugValues) => void) | null = null;
  private _pending: ReturnType<typeof setTimeout> | null = null;

  /** Delai de regroupement des ecritures, en millisecondes. */
  private static readonly DELAY_MS = 400;

  configure(persistence: DebugPersistence): void {
    this._values = structuredClone(persistence.values);
    this._persist = persistence.persist ?? null;
  }

  /** `undefined` si le chemin n'a jamais ete ecrit — un `null` reste une valeur. */
  read(path: string): unknown {
    let current: unknown = this._values;
    for (const segment of path.split(".")) {
      if (typeof current !== "object" || current === null) return undefined;
      current = (current as Record<string, unknown>)[segment];
    }
    return current;
  }

  write(path: string, value: unknown): void {
    if (!isStorable(value)) return;

    const segments = path.split(".");
    const last = segments.pop();
    if (!last) return;

    let current = this._values;
    for (const segment of segments) {
      const next = current[segment];
      if (typeof next !== "object" || next === null) current[segment] = {};
      current = current[segment] as DebugValues;
    }
    current[last] = serialize(value);
    this._schedule();
  }

  /** Ecriture immediate, sans attendre le regroupement. */
  flush(): void {
    if (this._pending) {
      clearTimeout(this._pending);
      this._pending = null;
    }
    this._persist?.(this._values);
  }

  snapshot(): DebugValues {
    return structuredClone(this._values);
  }

  private _schedule(): void {
    if (!this._persist) return;
    if (this._pending) clearTimeout(this._pending);
    this._pending = setTimeout(() => {
      this._pending = null;
      this._persist?.(this._values);
    }, DebugValueStore.DELAY_MS);
  }
}
