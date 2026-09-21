import {
  ClampToEdgeWrapping,
  Color,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  RGBAFormat,
  UnsignedByteType,
  type Wrapping,
} from "three";
import { abs, float, fwidth, length, max, mix, smoothstep, step, texture, uniform, vec2, vec3 } from "three/tsl";
import type { Node } from "three/webgpu";

/**
 * Encre et papier, partages par l'effet plein ecran (`InkEffect`, volumes extrudes) et le shader du sol
 * (parallaxe, dessinee dans la meme passe que le relief). Tout reglage est un uniform.
 */
export const inkSettings = {
  /** 0 : image telle quelle (carte de nuit), 1 : dessin. */
  amount: uniform(1),
  paper: uniform(new Color(0xf1ece0)),
  ink: uniform(new Color(0x1d2a4d)),
  /** Encre du lieu tenu sous la souris : son trait passe au rouge (marque posee par le sol, voir `HOVER_BAND`). */
  hoverInk: uniform(new Color(0xb3452f)),
  /** Lavis pose sur le papier du lieu survole : sans lui, un departement plat n'a presque pas de trait a teinter. */
  hoverWash: uniform(0.12),
  /** Force du trait de perimetre du lieu survole (0 : aucun). */
  hoverRim: uniform(0.9),
  /** Tons (luminance percue) : papier au-dessus de `light`, encre pleine sous `dark`. */
  light: uniform(0.8),
  dark: uniform(0.08),
  /**
   * Niveau de detail du crayon (0 : epure, 1 : tout dessine). Sous 1, les gris moyens rendent leurs traits au
   * papier et les contours faibles disparaissent : il ne reste que ce qui porte le dessin. Les noirs ne bougent pas.
   */
  detail: uniform(1),
  /** Pas des traits et de la trame (px) ; part des hachures (0 : trame de points, 1 : plume) ; hachures croisees au-dela de `cross`. */
  screen: uniform(5),
  hatching: uniform(1),
  cross: uniform(0.55),
  /** Au loin (0 a 1), traits plus fins et plus clairs : perspective d'atelier. */
  depth: uniform(0.6),
  /** Pointille de la vegetation, traits ondules de l'eau (0 : motif commun). */
  stipple: uniform(1),
  waves: uniform(1),
  /** Contours : ecart de lecture (px), saut de profondeur relatif, ecart d'orientation (1 - cos). */
  line: uniform(1),
  depthEdge: uniform(0.01),
  normalEdge: uniform(0.2),
  /** Main et impression : tremble (px), grain, bavure par taches. */
  wobble: uniform(1.5),
  grain: uniform(0.5),
  bleed: uniform(0.25),
  /** Papier : fibres et taches ; journal sous la carte (force, repetitions par largeur de bloc) ; nuages. */
  fibers: uniform(0.6),
  newsprint: uniform(0.6),
  newsprintScale: uniform(2),
  clouds: uniform(0.7),
};

const k = inkSettings;
const NOISE_SIZE = 256;
const PAPER_SIZE = 1024;
/**
 * Periode commune (pseudo-pixels) de tous les motifs : pas ajuste a une division entiere, bruits et
 * papier en puissances de deux. Accroches a la carte, leur origine peut sauter d'une periode sans
 * que rien ne bouge (voir `InkAnchor`).
 */
export const INK_PERIOD = 16384;
/** Taille (px) des ondulations du trait et des taches d'encre. */
export const WOBBLE_PX = 32;
const BLOT_PX = 64;
/** Nuages : taille de leur texture, nombre de nuages dessines dedans (cote a cote), et leur taille en scene. */
const CLOUDS_SIZE = [4096, 512] as const;
export const CLOUDS_COUNT = 4;
/** Unites de scene couvertes par la texture entiere : chaque nuage tient dans `CLOUDS_WORLD[0] / CLOUDS_COUNT`. */
export const CLOUDS_WORLD = [400, 24] as const;
const CLOUD_LINE_SPACING = 0.32;
/** Teinte moyenne de la texture du journal (lineaire) : autour d'elle, elle eclaircit ou assombrit le papier. */
const NEWSPRINT_MEAN = 0.8;

/** Bruit blanc RGBA en tuile : agrandi et filtre, il ondule ; lu au pixel, c'est un grain. */
function createNoise(): DataTexture {
  let seed = 11;
  const data = Uint8Array.from({ length: NOISE_SIZE * NOISE_SIZE * 4 }, () => (seed = (seed * 16807) % 2147483647) % 256);
  const noise = new DataTexture(data, NOISE_SIZE, NOISE_SIZE, RGBAFormat, UnsignedByteType);
  noise.wrapS = noise.wrapT = RepeatWrapping;
  noise.minFilter = noise.magFilter = LinearFilter;
  noise.needsUpdate = true;
  return noise;
}

/** Papier, dessine une fois et sans raccord : R fibres et grain, B taches et nuances de la pate. */
function createPaper(): DataTexture {
  let seed = 3;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  // Ce qui deborde d'un bord est redessine de l'autre cote : la feuille se repete sans couture.
  const around = (x: number, y: number, reach: number, draw: (x: number, y: number) => void) => {
    for (const dx of [-PAPER_SIZE, 0, PAPER_SIZE]) {
      for (const dy of [-PAPER_SIZE, 0, PAPER_SIZE]) {
        if (x + dx + reach < 0 || x + dx - reach > PAPER_SIZE || y + dy + reach < 0 || y + dy - reach > PAPER_SIZE) continue;
        draw(x + dx, y + dy);
      }
    }
  };
  const layer = (draw: (pen: OffscreenCanvasRenderingContext2D) => void) => {
    const pen = new OffscreenCanvas(PAPER_SIZE, PAPER_SIZE).getContext("2d", {
      willReadFrequently: true,
    })!;
    draw(pen);
    return pen.getImageData(0, 0, PAPER_SIZE, PAPER_SIZE).data;
  };
  const fibers = layer((pen) => {
    pen.fillStyle = "rgb(128,128,128)";
    pen.fillRect(0, 0, PAPER_SIZE, PAPER_SIZE);
    pen.lineWidth = 1;
    for (let i = 0; i < 6000; i++) {
      const x = random() * PAPER_SIZE;
      const y = random() * PAPER_SIZE;
      const angle = random() * Math.PI * 2;
      const length = 6 + random() * 26;
      pen.strokeStyle = random() > 0.5 ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.14)";
      around(x, y, length, (x, y) => {
        pen.beginPath();
        pen.moveTo(x, y);
        pen.quadraticCurveTo(
          x + Math.cos(angle + 0.6) * length * 0.5,
          y + Math.sin(angle + 0.6) * length * 0.5,
          x + Math.cos(angle) * length,
          y + Math.sin(angle) * length,
        );
        pen.stroke();
      });
    }
  });
  const stains = layer((pen) => {
    pen.fillStyle = "rgb(128,128,128)";
    pen.fillRect(0, 0, PAPER_SIZE, PAPER_SIZE);
    for (let i = 0; i < 90; i++) {
      const x = random() * PAPER_SIZE;
      const y = random() * PAPER_SIZE;
      const radius = 40 + random() * 220;
      const tone = random() > 0.5 ? 255 : 0;
      const alpha = 0.05 + random() * 0.08;
      around(x, y, radius, (x, y) => {
        const gradient = pen.createRadialGradient(x, y, 0, x, y, radius);
        gradient.addColorStop(0, `rgba(${tone},${tone},${tone},${alpha})`);
        gradient.addColorStop(1, `rgba(${tone},${tone},${tone},0)`);
        pen.fillStyle = gradient;
        pen.fillRect(x - radius, y - radius, radius * 2, radius * 2);
      });
    }
  });
  const data = new Uint8Array(PAPER_SIZE * PAPER_SIZE * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = fibers[i]!;
    data[i + 2] = stains[i]!;
    data[i + 3] = 255;
  }
  const paper = new DataTexture(data, PAPER_SIZE, PAPER_SIZE, RGBAFormat, UnsignedByteType);
  paper.wrapS = paper.wrapT = RepeatWrapping;
  paper.minFilter = LinearMipmapLinearFilter;
  paper.magFilter = LinearFilter;
  paper.generateMipmaps = true;
  paper.needsUpdate = true;
  return paper;
}

/**
 * Nuages dessines, facon Chartogne-Taillet : des cumulus poses sur une base, faits de traits horizontaux ondules
 * (R : part d'encre). La bande boucle en largeur : elle fait le tour de la scene.
 */
/**
 * Nuages facon Chartogne-Taillet : cumulus a base plate faits de traits horizontaux, plus gras et continus dans
 * l'ombre (dessous, cote oppose au soleil), rompus puis absents dans la lumiere ; aucun contour. Dessines en unites
 * de la bande (`CLOUDS_WORLD`), pour que leurs bosses restent rondes une fois posees sur le cylindre.
 */
function createClouds(): DataTexture {
  const [width, height] = CLOUDS_SIZE;
  const [unitsWide, unitsHigh] = CLOUDS_WORLD;
  const [pxPerU, pxPerV] = [width / unitsWide, height / unitsHigh];
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  // Soleil en haut a gauche (u vers la droite, v vers le haut).
  const [lightU, lightV] = [-0.55, 0.83];
  const ink = new Float32Array(width * height);
  // Bruit par trait et par tronçon : ou le trait se rompt.
  const dash = (line: number, u: number) => {
    const n = Math.sin(line * 12.9898 + Math.floor(u / 4) * 78.233) * 43758.5453;
    return n - Math.floor(n);
  };
  const count = CLOUDS_COUNT;
  for (let c = 0; c < count; c++) {
    // Un nuage par case, bien au milieu : chaque case est posee a part dans le ciel (`CloudsNode`).
    const center = ((c + 0.5) / count) * unitsWide;
    const span = 28 + random() * 22;
    const tall = 10 + random() * 4;
    const base = 1.5 + random() * 1.5;
    // Bosses qui se chevauchent : une rangee basse sur toute la largeur, une haute au milieu.
    const bumps: [number, number, number][] = [];
    const low = Math.ceil(span / (tall * 0.55)) + 1;
    for (let i = 0; i < low; i++) {
      const t = i / (low - 1);
      const r = tall * (0.34 + 0.22 * Math.sin(Math.PI * t)) * (0.9 + random() * 0.25);
      bumps.push([center - span / 2 + t * span, base + r * (0.55 + random() * 0.2), r]);
    }
    const high = 2 + Math.floor(random() * 3);
    for (let i = 0; i < high; i++) {
      const t = (i + 0.5) / high;
      const r = tall * (0.34 + random() * 0.12);
      bumps.push([center - span * 0.28 + t * span * 0.56, base + tall * (0.55 + random() * 0.15), r]);
    }
    const [u0, u1] = [center - span / 2 - tall, center + span / 2 + tall];
    for (let py = 0; py < height; py++) {
      const v = (height - 1 - py) / pxPerV;
      if (v < base || v > base + tall * 1.4) continue;
      for (let px = Math.floor(u0 * pxPerU); px < Math.ceil(u1 * pxPerU); px++) {
        const u = px / pxPerU;
        // Bosse la plus englobante : sa normale donne l'eclairage.
        let best = -1;
        let [nu, nv] = [0, 1];
        for (const [bu, bv, r] of bumps) {
          const [du, dv] = [u - bu, v - bv];
          const inside = 1 - Math.hypot(du, dv) / r;
          if (inside > best) {
            best = inside;
            const d = Math.hypot(du, dv) || 1;
            [nu, nv] = [du / d, dv / d];
          }
        }
        if (best <= 0) continue;
        // Pres du bord, la normale est celle de la bosse ; au coeur, la masse est plutot face a nous.
        const rim = Math.min(1, best * 3);
        const lambert = (nu * lightU + nv * lightV) * (1 - rim * 0.6);
        const under = 1 - Math.min(1, (v - base) / (tall * 0.35));
        const shade = Math.min(1, Math.max(0.3, 0.45 - 0.5 * lambert + 0.3 * under));
        // Traits horizontaux ondules ; epaisseur et continuite selon l'ombre.
        const wave = Math.sin(u * 0.35 + c) * 0.08;
        const line = (v + wave) / CLOUD_LINE_SPACING;
        const index = Math.floor(line);
        const distance = Math.abs(line - index - 0.5);
        const widthShare = 0.07 + shade * 0.13;
        const aa = 0.5 / (CLOUD_LINE_SPACING * pxPerV);
        const stroke = Math.min(1, Math.max(0, (widthShare + aa - distance) / (2 * aa)));
        // Dans la lumiere, des traits epars et fins ; dans l'ombre, continus.
        const broken = dash(index + c * 97, u + index * 0.7) < 0.45 + shade * 0.6 ? 1 : 0;
        // Bord doux : les traits meurent vers la silhouette.
        const edge = Math.min(1, best * 6);
        const value = stroke * broken * edge * (0.45 + 0.45 * shade);
        // Le tour boucle : un nuage a cheval sur le raccord continue de l'autre cote.
        const at = py * width + (((px % width) + width) % width);
        ink[at] = Math.max(ink[at]!, value);
      }
    }
  }
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < ink.length; i++) {
    data[i * 4] = Math.round(ink[i]! * 255);
    data[i * 4 + 3] = 255;
  }
  const clouds = new DataTexture(data, width, height, RGBAFormat, UnsignedByteType);
  clouds.wrapS = RepeatWrapping;
  clouds.wrapT = ClampToEdgeWrapping;
  clouds.minFilter = LinearMipmapLinearFilter;
  clouds.magFilter = LinearFilter;
  clouds.generateMipmaps = true;
  clouds.needsUpdate = true;
  return clouds;
}

const noiseMap = texture(createNoise());
/**
 * Texture d'attente, en place jusqu'au vrai dessin : meme repetition que lui, l'echantillonneur est cree avec elle
 * (en bord fixe, le papier filait en trainees au-dela de 1024 px, les nuages en traits continus).
 */
const placeholder = (rgba: readonly number[], wrapT: Wrapping = RepeatWrapping) => {
  const map = new DataTexture(Uint8Array.from(rgba), 1, 1, RGBAFormat, UnsignedByteType);
  map.wrapS = RepeatWrapping;
  map.wrapT = wrapT;
  map.needsUpdate = true;
  return map;
};
// Papier neutre et ciel vide au demarrage ; les vrais sont dessines quand le navigateur a du temps libre.
const paperMap = texture(placeholder([128, 0, 128, 255]));
/**
 * Nuages dessines (une bande de `CLOUDS_COUNT` nuages, lue par le ciel) : ils arrivent a la premiere accalmie,
 * apres les materiaux qui les lisent, d'ou l'attente plutot qu'une texture d'attente (un echantillonneur cree
 * avec elle ne reprend pas la vraie).
 */
let cloudsDrawn: DataTexture | null = null;
const cloudsWaiting: ((map: DataTexture) => void)[] = [];
export function onCloudsDrawn(use: (map: DataTexture) => void): void {
  if (cloudsDrawn) use(cloudsDrawn);
  else cloudsWaiting.push(use);
}
/**
 * Journal sous la carte : texture sans raccord (image du projet, posee par l'univers une fois chargee), a plat sur
 * le sol. Blanc tant qu'elle n'est pas la.
 */
export const newsprintMap = texture(placeholder([255, 255, 255, 255]));
const draft = () => {
  paperMap.value = createPaper();
  cloudsDrawn = createClouds();
  for (const use of cloudsWaiting.splice(0)) use(cloudsDrawn);
};
if (typeof requestIdleCallback === "function") requestIdleCallback(draft, { timeout: 3000 });
else setTimeout(draft, 1000);

/** Bruit au pixel `pixel`, en cellules de `cellPx` pixels. */
export const inkNoise = (pixel: Node, cellPx: number): Node => noiseMap.sample(pixel.div(cellPx * NOISE_SIZE));

/**
 * Ou poser motifs et papier. En pixels d'ecran (`at` seul), ou accroches a la carte : coordonnees a deux
 * echelles (`at`, `next`) fondues par `blend` pendant le zoom, pour garder un pas a peu pres constant.
 */
export interface InkAnchor {
  at: Node;
  next?: Node;
  blend?: Node;
}

/** `sample` aux deux echelles de l'ancre, fondues ; `index` : 0 pour `at`, 1 pour `next`. */
function blended(anchor: InkAnchor, sample: (at: Node, index: 0 | 1) => Node): Node {
  if (!anchor.next || !anchor.blend) return sample(anchor.at, 0);
  return mix(sample(anchor.at, 0), sample(anchor.next, 1), anchor.blend);
}

/** Pas `pitch` ajuste pour tomber un nombre entier de fois dans `INK_PERIOD`. */
const fitted = (pitch: Node) => float(INK_PERIOD).div(float(INK_PERIOD).div(pitch).round());

/** Papier : fibres et taches de la pate. */
export function paperAt(anchor: InkAnchor): Node {
  return blended(anchor, (at) => {
    const fibers = paperMap.sample(at.div(PAPER_SIZE));
    // Pate : fibres, nuages de la feuille, et grain fin de la photocopie.
    const pulp = float(1)
      .add(fibers.r.sub(0.5).mul(0.4).add(fibers.b.sub(0.5).mul(0.5)).mul(k.fibers))
      .sub(inkNoise(at, 1).r.mul(k.grain).mul(0.08));
    return k.paper.mul(pulp);
  });
}

/**
 * Journal sous la carte, au point `xz` du sol (unites de scene) : teinte de la texture autour de sa moyenne, de
 * force `newsprint`, repetee `newsprintScale` fois par largeur de bloc (100 unites). S'efface vers l'horizon, ou
 * elle filerait en traits.
 */
export function newsprintAt(xz: Node, fade: Node): Node {
  const tint = newsprintMap.sample(xz.mul(k.newsprintScale.div(100))).rgb.div(NEWSPRINT_MEAN);
  return mix(vec3(1), tint, k.newsprint.mul(fade));
}

/** Nature de la surface dessinee : chaque motif pese de 0 a 1, `far` de 0 (pres) a 1 (loin). */
export interface InkSurface {
  far: Node;
  /** Murs : traits verticaux le long de `along` (pseudo-pixels accroches au mur, une valeur par echelle de l'ancre). */
  wall?: Node;
  along?: [Node, Node?];
  vegetation?: Node;
  water?: Node;
}

/** Trait de largeur `width` (fraction du pas) tous les entiers de `coord`, un peu tremblant. */
function stroke(coord: Node, width: Node, tremble: Node): Node {
  const distance = abs(coord.add(tremble).fract().sub(0.5));
  const soft = fwidth(coord);
  return smoothstep(width.sub(soft), width.add(soft), distance).oneMinus();
}

/**
 * Part d'encre (0 a 1) d'un ton `tone` (luminance percue), selon la surface. Accroches a la carte, les
 * motifs se resserrent d'eux-memes au loin (perspective) : la profondeur n'y fait qu'eclaircir le trait.
 */
export function inkCoverage(tone: Node, anchor: InkAnchor, surface: InkSurface): Node {
  const distance = surface.far.mul(k.depth);
  // Le niveau de detail creuse les gris moyens : eleve a une puissance, un ton clair perd ses traits alors qu'un
  // noir reste noir. C'est le reglage qui separe un dessin epure d'un dessin charge.
  const density = smoothstep(k.dark, k.light, tone)
    .oneMinus()
    .pow(mix(float(2.6), float(1), k.detail))
    .mul(distance.mul(0.45).oneMinus());
  const pattern = blended(anchor, (px, index) => {
    const tremble = inkNoise(px, WOBBLE_PX).z.sub(0.5).mul(0.6);
    // Diagonales sans division par racine de 2 : le pas reste un diviseur de la periode.
    const diagonal = fitted(k.screen.mul(Math.SQRT2));
    const turned = vec2(px.x.add(px.y), px.y.sub(px.x)).div(diagonal);

    // Sol et toits : hachures a 45 degres, croisees dans les noirs ; ou trame de points.
    const hatches = max(
      stroke(turned.x, density.mul(0.45), tremble),
      stroke(turned.y, density.sub(k.cross).max(0).mul(0.9), tremble).mul(step(k.cross, density)),
    );
    const cell = length(turned.fract().sub(0.5));
    const radius = density
      .sqrt()
      .mul(0.75)
      .add(inkNoise(px, 4).g.sub(0.5).mul(k.grain.mul(0.3)));
    const aa = fwidth(cell);
    const dots = smoothstep(radius.sub(aa), radius.add(aa), cell).oneMinus();
    // Pas de voile de traits fins sur les clairs.
    let ink: Node = mix(dots, hatches.mul(smoothstep(0.08, 0.2, density)), k.hatching);

    const along = surface.along?.[index];
    if (surface.wall && along) {
      const vertical = stroke(along.div(fitted(k.screen)), density.mul(0.45), tremble).mul(smoothstep(0.05, 0.15, density));
      ink = mix(ink, vertical, surface.wall);
    }
    if (surface.vegetation) {
      const stipple = smoothstep(0.62, 0.7, inkNoise(px, 2).a.add(density.max(0.3).mul(0.35)));
      ink = mix(ink, max(ink, stipple), surface.vegetation.mul(k.stipple));
    }
    if (surface.water) {
      const ripple = px.y.div(fitted(k.screen.mul(1.4))).add(inkNoise(px, BLOT_PX).x.sub(0.5).mul(0.6));
      ink = mix(ink, max(ink, stroke(ripple, density.max(0.25).mul(0.3), tremble)), surface.water.mul(k.waves));
    }
    const blot = smoothstep(0.65, 0.95, inkNoise(px, BLOT_PX).b).mul(k.bleed).mul(density);
    return max(ink, blot);
  });
  const solid = smoothstep(k.dark, k.dark.mul(2), tone).oneMinus();
  return max(pattern, solid).clamp(0, 1);
}

/**
 * Encre sur `paper` selon la part `coverage` : encre inegale, jamais tout a fait pleine (photocopie).
 * `tint` fait passer le trait a l'encre du survol et pose un lavis sur le papier : le lieu tenu sous la souris.
 */
export function inkOnPaper(coverage: Node, anchor: InkAnchor, paper: Node, tint?: Node): Node {
  const grain = blended(anchor, (at) => inkNoise(at, 1).r);
  const uneven = mix(k.ink, k.ink.mul(1.6), blended(anchor, (at) => inkNoise(at, 4).g).mul(k.grain));
  const ink = tint ? mix(uneven, k.hoverInk, tint) : uneven;
  const sheet = tint ? mix(paper, k.hoverInk, tint.mul(k.hoverWash)) : paper;
  return mix(sheet, ink, coverage.mul(float(1).sub(grain.mul(k.grain).mul(0.25))));
}
