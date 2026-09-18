import { Color, DataTexture, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping, RGBAFormat, UnsignedByteType } from "three";
import { abs, float, fwidth, length, max, mix, smoothstep, step, texture, uniform, vec2 } from "three/tsl";
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
  /** Tons (luminance percue) : papier au-dessus de `light`, encre pleine sous `dark`. */
  light: uniform(0.8),
  dark: uniform(0.08),
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
  /** Papier : fibres et taches ; journal vu par transparence la ou la carte s'efface. */
  fibers: uniform(0.6),
  newsprint: uniform(0.25),
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

const WORDS = [
  "élection", "conseil", "municipal", "préfecture", "canton", "scrutin", "député", "maire", "séance", "communiqué",
  "région", "assemblée", "gouvernement", "réforme", "territoire", "édition", "rédaction", "commune", "vote", "liste",
  "candidat", "sondage", "presse", "journal", "tribune", "la", "le", "des", "et", "du", "en", "au", "pour", "sur",
];

/**
 * Papier de journal, dessine une fois : R fibres et grain, G une page imprimee vue a l'envers par
 * transparence (colonnes de texte, titres, cliches trames), B taches et nuances de la pate.
 */
function createPaper(): DataTexture {
  let seed = 3;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const layer = (draw: (pen: OffscreenCanvasRenderingContext2D) => void) => {
    const pen = new OffscreenCanvas(PAPER_SIZE, PAPER_SIZE).getContext("2d", { willReadFrequently: true })!;
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
      pen.beginPath();
      pen.moveTo(x, y);
      pen.quadraticCurveTo(
        x + Math.cos(angle + 0.6) * length * 0.5,
        y + Math.sin(angle + 0.6) * length * 0.5,
        x + Math.cos(angle) * length,
        y + Math.sin(angle) * length
      );
      pen.stroke();
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
      const gradient = pen.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, `rgba(${tone},${tone},${tone},${0.05 + random() * 0.08})`);
      gradient.addColorStop(1, `rgba(${tone},${tone},${tone},0)`);
      pen.fillStyle = gradient;
      pen.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }
  });
  // Cliche trame : un motif de points, pose d'un seul `fillRect` (un point a la fois couterait des secondes).
  const dot = new OffscreenCanvas(5, 5).getContext("2d")!;
  dot.fillStyle = "#fff";
  dot.beginPath();
  dot.arc(2.5, 2.5, 1.6, 0, Math.PI * 2);
  dot.fill();
  const page = new OffscreenCanvas(PAPER_SIZE, PAPER_SIZE).getContext("2d")!;
  {
    const pen = page;
    // Vue par transparence : la page est a l'envers.
    pen.translate(PAPER_SIZE, 0);
    pen.scale(-1, 1);
    pen.fillStyle = "#fff";
    const columns = 5;
    const gutter = 18;
    const width = (PAPER_SIZE - gutter * (columns + 1)) / columns;
    pen.font = "bold 46px Georgia, 'Times New Roman', serif";
    pen.fillText("LA VIE DES TERRITOIRES", gutter, 60);
    for (let c = 0; c < columns; c++) {
      const x = gutter + c * (width + gutter);
      let y = 100;
      while (y < PAPER_SIZE - 20) {
        if (random() < 0.07) {
          const h = 80 + random() * 140;
          pen.fillStyle = pen.createPattern(dot.canvas, "repeat")!;
          pen.fillRect(x, y, width, h);
          pen.fillStyle = "#fff";
          y += h + 14;
          continue;
        }
        if (random() < 0.06) {
          pen.font = "bold 20px Georgia, 'Times New Roman', serif";
          y += 12;
        } else pen.font = "12px Georgia, 'Times New Roman', serif";
        let line = "";
        while (pen.measureText(line).width < width - 30) line += `${WORDS[Math.floor(random() * WORDS.length)]} `;
        pen.fillText(line.trim(), x, y, width);
        y += pen.font.startsWith("bold") ? 26 : 15;
      }
    }
  }
  // Un peu floue, comme vue a travers la feuille : un seul flou sur toute la page. Pose trait par trait,
  // le filtre de flou refait son calcul a chaque dessin (~30 s au demarrage).
  const newsprint = layer((pen) => {
    pen.filter = "blur(0.7px)";
    pen.drawImage(page.canvas, 0, 0);
  });
  const data = new Uint8Array(PAPER_SIZE * PAPER_SIZE * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = fibers[i]!;
    data[i + 1] = newsprint[i]!;
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

const noiseMap = texture(createNoise());
// Papier neutre au demarrage ; le vrai est dessine quand le navigateur a du temps libre, apres les premieres images.
const paperMap = texture(new DataTexture(new Uint8Array([128, 0, 128, 255]), 1, 1, RGBAFormat, UnsignedByteType));
paperMap.value.needsUpdate = true;
const draftPaper = () => {
  paperMap.value = createPaper();
};
if (typeof requestIdleCallback === "function") requestIdleCallback(draftPaper, { timeout: 3000 });
else setTimeout(draftPaper, 1000);

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

/** Papier : fibres, taches, et journal par transparence la ou `fade` (0 a 1) efface la carte. */
export function paperAt(anchor: InkAnchor, fade: Node): Node {
  return blended(anchor, (at) => {
    const fibers = paperMap.sample(at.div(PAPER_SIZE));
    // Le journal a une autre echelle que les fibres : leurs repetitions ne coincident pas.
    const print = paperMap.sample(at.div(PAPER_SIZE * 2).add(0.37)).g;
    const pulp = float(1).add(fibers.r.sub(0.5).mul(0.25).add(fibers.b.sub(0.5).mul(0.35)).mul(k.fibers));
    return mix(k.paper.mul(pulp), k.ink, print.mul(k.newsprint).mul(fade).mul(0.3));
  });
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
  const density = smoothstep(k.dark, k.light, tone).oneMinus().mul(distance.mul(0.45).oneMinus());
  const pattern = blended(anchor, (px, index) => {
    const tremble = inkNoise(px, WOBBLE_PX).z.sub(0.5).mul(0.6);
    // Diagonales sans division par racine de 2 : le pas reste un diviseur de la periode.
    const diagonal = fitted(k.screen.mul(Math.SQRT2));
    const turned = vec2(px.x.add(px.y), px.y.sub(px.x)).div(diagonal);

    // Sol et toits : hachures a 45 degres, croisees dans les noirs ; ou trame de points.
    const hatches = max(
      stroke(turned.x, density.mul(0.45), tremble),
      stroke(turned.y, density.sub(k.cross).max(0).mul(0.9), tremble).mul(step(k.cross, density))
    );
    const cell = length(turned.fract().sub(0.5));
    const radius = density.sqrt().mul(0.75).add(inkNoise(px, 4).g.sub(0.5).mul(k.grain.mul(0.3)));
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

/** Encre sur `paper` selon la part `coverage` : encre inegale, jamais tout a fait pleine (photocopie). */
export function inkOnPaper(coverage: Node, anchor: InkAnchor, paper: Node): Node {
  const grain = blended(anchor, (at) => inkNoise(at, 1).r);
  const ink = mix(k.ink, k.ink.mul(1.6), blended(anchor, (at) => inkNoise(at, 4).g).mul(k.grain));
  return mix(paper, ink, coverage.mul(float(1).sub(grain.mul(k.grain).mul(0.25))));
}
