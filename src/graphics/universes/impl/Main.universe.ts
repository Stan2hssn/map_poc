import type { IThreeDeviceSlice } from "@/_core/systems/ThreeDevice.ts";
import type { DebugTarget } from "@_core/debug/index.ts";
import { NodeGraph } from "@_core/nodes/NodeGraph.ts";
import { UniverseBase } from "@_core/universes/Universe.base.ts";
import { ASSET_KEYS } from "@graphics/assets/assets.manifest.ts";
import { TERRAIN_CONFIG } from "@graphics/config/terrain.config.ts";
import { CITY_EXTENT_KM } from "@graphics/config/views.config.ts";
import { FOLDER_ID, TAB_ID } from "@graphics/debug/Debug.id.ts";
import { RenderStatsHelper } from "@graphics/debug/RenderStats.helper.ts";
import { DynamicQualityHelper } from "@graphics/device/DynamicQuality.helper.ts";
import { inkAnchorAt, terrainSettings } from "@graphics/materials/Terrain.material.ts";
import { NODE_ID } from "@graphics/nodes/Node.id.ts";
import { BuildingsNode } from "@graphics/nodes/buildings/Buildings.node.ts";
import { MapCameraNode } from "@graphics/nodes/cameras/MapCamera.node.ts";
import type { MapFocusId } from "@graphics/config/focus.config.ts";
import { labelSettings } from "@graphics/materials/Label.material.ts";
import { Labels3DNode } from "@graphics/nodes/labels/Labels3D.node.ts";
import { IntroNode } from "@graphics/nodes/intro/Intro.node.ts";
import { PanelNode } from "@graphics/nodes/panel/Panel.node.ts";
import { CloudsNode } from "@graphics/nodes/sky/Clouds.node.ts";
import { PlanesNode } from "@graphics/nodes/sky/Planes.node.ts";
import { SurveyNode } from "@graphics/nodes/survey/Survey.node.ts";
import { LightsNode } from "@graphics/nodes/lights/Lights.node.ts";
import { TerrainNode } from "@graphics/nodes/terrain/Terrain.node.ts";
import { EffectComposer, EffectPass, InkEffect, inkSettings, newsprintMap, OverlayPass, RenderPass } from "@graphics/postprocessing/index.ts";
import { IgnElevationProvider } from "@graphics/terrain/IgnElevationProvider.ts";
import type IMapNavigator from "@graphics/universes/MapNavigator.interface.ts";
import type { MapView, SelectedPlace } from "@graphics/universes/MapNavigator.interface.ts";
import { Color, Matrix4, Scene, type Camera, type Texture } from "three";
import type { WebGPURenderer } from "three/webgpu";
import type { UniverseId } from "../Universe.id.ts";
import { UNIVERSE_ID } from "../Universe.id.ts";

const BACKGROUND = 0x000000;
/**
 * Au repos (camera et vue immobiles), la scene ne se rend plus qu'a cette cadence : seule la brume derive,
 * lentement ; voitures, bateaux et avions, eux, bougent a `LIVELY_FPS`.
 */
const IDLE_FPS = 15;
const LIVELY_FPS = 30;
/** Choix de subdivisions du sol, pour le panneau. */
const SEGMENT_OPTIONS = Object.fromEntries(TERRAIN_CONFIG.segmentOptions.map((n) => [`${n} x ${n}`, n]));
const SUN_CONTROLS = [
  ["azimuth", { label: "soleil azimut", min: 0, max: 360, step: 1 }],
  ["elevation", { label: "soleil elevation", min: 5, max: 90, step: 1 }],
  ["intensity", { label: "soleil intensite", min: 0, max: 10, step: 0.1 }],
  ["ambient", { label: "ambiance", min: 0, max: 3, step: 0.05 }],
  ["bounce", { label: "rebond", min: 0, max: 1, step: 0.01 }],
] as const;
/** Trait : ce qui dessine. */
const INK_CONTROLS = [
  ["amount", { label: "dessin", min: 0, max: 1, step: 1 }],
  ["detail", { label: "niveau de detail", min: 0, max: 1, step: 0.01 }],
  ["light", { label: "ton papier", min: 0.1, max: 2, step: 0.01 }],
  ["dark", { label: "ton encre", min: 0, max: 0.5, step: 0.005 }],
  ["screen", { label: "trame (px)", min: 2, max: 16, step: 0.5 }],
  ["hatching", { label: "points / plume", min: 0, max: 1, step: 0.01 }],
  ["cross", { label: "hachures croisees", min: 0.2, max: 1, step: 0.01 }],
  ["depth", { label: "profondeur", min: 0, max: 1, step: 0.01 }],
  ["line", { label: "trait (px)", min: 0.5, max: 4, step: 0.1 }],
  ["depthEdge", { label: "contour profondeur", min: 0.001, max: 0.1, step: 0.001 }],
  ["normalEdge", { label: "contour arete", min: 0.02, max: 1, step: 0.01 }],
  ["wobble", { label: "tremble (px)", min: 0, max: 6, step: 0.1 }],
  ["grain", { label: "grain", min: 0, max: 1, step: 0.01 }],
] as const;
/** Support : papier, journal, et l'encre des nuages. */
const PAPER_CONTROLS = [
  ["bleed", { label: "bavure", min: 0, max: 1, step: 0.01 }],
  ["fibers", { label: "fibres du papier", min: 0, max: 2, step: 0.01 }],
  ["newsprint", { label: "journal", min: 0, max: 2, step: 0.01 }],
  ["newsprintScale", { label: "journal echelle", min: 0.1, max: 20, step: 0.1 }],
  ["clouds", { label: "traits des nuages", min: 0, max: 1, step: 0.01 }],
] as const;
/** Ombrage du bati : la marche dans la texture de hauteurs. */
const SHADING_CONTROLS = [
  ["fineSteps", { label: "pas fins", min: 1, max: 96, step: 1 }],
  ["stepTexels", { label: "texels par pas", min: 0.5, max: 8, step: 0.25 }],
  ["coarseSteps", { label: "pas par cellule", min: 1, max: 48, step: 1 }],
  ["shadowSoftness", { label: "penombre", min: 0, max: 0.5, step: 0.01 }],
  ["lodBias", { label: "mip (flou)", min: 0, max: 4, step: 0.1 }],
  ["contact", { label: "creux au pied", min: 0, max: 1, step: 0.01 }],
] as const;

/** Eau dessinee : des droites a 45 degres qui s'effacent vers le milieu de l'eau (voir `terrainSettings`). */
const WATER_CONTROLS = [
  ["waterInk", { label: "trait", min: 0, max: 1, step: 0.05 }],
  ["waterLines", { label: "traits (serrage)", min: 4, max: 80, step: 1 }],
  ["waterWidth", { label: "epaisseur", min: 0.02, max: 0.4, step: 0.01 }],
  ["waterReach", { label: "espacement vers le centre", min: 0.01, max: 0.6, step: 0.01 }],
  ["waterWave", { label: "ondulation", min: 0, max: 3, step: 0.05 }],
  ["waterSurf", { label: "tremble au bord", min: 0, max: 3, step: 0.05 }],
  ["seaTone", { label: "ton de la mer", min: 0.5, max: 1, step: 0.01 }],
] as const;

/** Marge autour d'un territoire quand on vole jusqu'a lui : il ne touche pas les bords. */
const FIT_MARGIN = 1.25;

/** Largeur de vue (km) qui contient le contour, sans descendre sous l'echelle d'une ville. */
function extentOfRings(rings: [number, number][][]): number {
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (const ring of rings)
    for (const [lon, lat] of ring) {
      west = Math.min(west, lon);
      east = Math.max(east, lon);
      south = Math.min(south, lat);
      north = Math.max(north, lat);
    }
  const cos = Math.cos((((south + north) / 2) * Math.PI) / 180);
  const km = Math.max((east - west) * 111.32 * cos, (north - south) * 111.32);
  return Math.max(CITY_EXTENT_KM, km * FIT_MARGIN);
}

/** Camera immobile : aucun coefficient de sa matrice n'a bouge de plus que cela. */
const STILL = 1e-5;
/** Duree (ms) de l'ouverture de la carte a l'intro. */
const INTRO_MS = 3000;

export class MainUniverse extends UniverseBase<UniverseId> implements IMapNavigator {
  private readonly _cameraNode: MapCameraNode;
  private readonly _lights = new LightsNode();
  private readonly _terrain: TerrainNode;
  private readonly _labels: Labels3DNode;
  private readonly _panel: PanelNode;
  private readonly _intro3d: IntroNode;
  private readonly _survey: SurveyNode;
  private readonly _buildings: BuildingsNode;
  private readonly _planes: PlanesNode;
  private readonly _clouds: CloudsNode;
  private readonly _renderStats: RenderStatsHelper;
  private readonly _ink: InkEffect;
  private readonly _inkPass: EffectPass;
  private readonly _renderer: WebGPURenderer;
  private readonly _assets: IThreeDeviceSlice["assets"];
  private readonly _quality: DynamicQualityHelper;
  /** Pixels rendus par pixel CSS, pour le panneau. */
  private readonly _resolution = { pixelRatio: 1, auto: true, scene: 1 };
  private _nodesRegistered = false;
  private readonly _composer: EffectComposer;
  private readonly _renderedCamera = new Matrix4();
  private _sinceRender = Infinity;
  /**
   * Intro : part ouverte de la zone dessinee, et la part visee. La page nait blanche — attendre que la page
   * appelle `holdIntro` laisserait la carte paraitre le temps d'une image ; c'est `drawMap` (ou toute
   * navigation) qui l'ouvre.
   */
  private readonly _intro = { reveal: 0, target: 0 };
  private readonly _selectionListeners = new Set<(place: SelectedPlace) => void>();

  constructor(device: IThreeDeviceSlice) {
    const scene = new Scene();
    scene.background = new Color(BACKGROUND);

    const terrain = new TerrainNode(new IgnElevationProvider());
    const cameraNode = new MapCameraNode(
      device.input,
      device.renderer.domElement,
      terrain.rect,
      (x, z) => terrain.heightAt(x, z),
      terrain,
      {
        pan: (dx, dz) => terrain.moveBy(dx, dz),
        zoom: (factor, x, z) => terrain.zoomAt(factor, x, z),
        fling: (vx, vz) => terrain.fling(vx, vz),
      },
    );

    // Tremble du trait accroche a la carte.
    const ink = new InkEffect({ anchorAt: inkAnchorAt });
    const inkPass = new EffectPass([ink]);
    // L'interface se dessine apres l'encre : sinon la passe la prendrait pour un relief et la hachurerait.
    // La feuille du panneau vient par-dessus les noms, puisqu'elle les recouvre.
    const labelsPass = new OverlayPass(() => this._labels.scene);
    const panelPass = new OverlayPass(() => this._panel.scene);
    const introPass = new OverlayPass(() => this._intro3d.scene);
    const composer = new EffectComposer([new RenderPass(), inkPass, labelsPass, panelPass, introPass], {
      normalDepth: true,
    });
    super(
      UNIVERSE_ID.MAIN,
      scene,
      cameraNode.camera,
      new NodeGraph(scene),
      composer,
      device.assets.preloadGroup.bind(device.assets),
      device.debug,
    );

    // Sonde de developpement, comme `__stage` : reglages des shaders depuis la console.
    if (import.meta.env?.DEV)
      Object.assign(globalThis, {
        __map: { terrain: terrainSettings, ink: inkSettings },
      });
    this._ink = ink;
    this._inkPass = inkPass;
    this._renderer = device.renderer as WebGPURenderer;
    this._assets = device.assets;
    this._composer = composer;
    // La scene se rend plus petite quand la cadence decroche ; l'encre reste a pleine resolution.
    this._quality = new DynamicQualityHelper((scale) => {
      composer.sceneScale = scale;
      this._resolution.scene = scale;
    });
    this._resolution.pixelRatio = this._renderer.getPixelRatio();
    this._cameraNode = cameraNode;
    this._terrain = terrain;
    this._planes = new PlanesNode(terrain);
    this._clouds = new CloudsNode(terrain, () => cameraNode.camera);
    terrain.projectFrom = () => cameraNode.camera;
    terrain.lookAxis = (into) => cameraNode.lookAxis(into);
    // Un nom de ville clique : vol jusqu'a elle, bati en relief, sans reculer si l'on est deja plus pres.
    this._labels = new Labels3DNode(device.renderer.domElement, terrain, () => this.camera as Camera, (place) => {
      this.goToPlace({ name: place.name, lon: place.lon, lat: place.lat });
      for (const listener of this._selectionListeners) listener({ name: place.name, lon: place.lon, lat: place.lat });
    });
    this._panel = new PanelNode(device.renderer.domElement, () => this.camera as Camera);
    this._intro3d = new IntroNode(device.renderer.domElement, () => this.camera as Camera);
    this._survey = new SurveyNode(terrain, device.renderer.domElement, () => this.camera as Camera);
    this._buildings = new BuildingsNode(terrain);
    // map tourne sur WebGPURenderer (WebGPU ou son repli WebGL2).
    this._renderStats = new RenderStatsHelper(device.renderer as WebGPURenderer);
    cameraNode.isActive = () => this.camera === cameraNode.camera;
    // La carte se fige quand on vise un nom : sinon la parallaxe le deplace pendant qu'on l'approche.
    cameraNode.holdParallax = () => this._labels.aiming;

    this.registerContract({
      id: NODE_ID.CONTRACT_BASE,
      activeNodeIds: [
        NODE_ID.CAMERA_MAIN,
        NODE_ID.LIGHTS,
        NODE_ID.TERRAIN,
        NODE_ID.BUILDINGS,
        NODE_ID.PLANES,
        NODE_ID.CLOUDS,
        NODE_ID.SURVEY,
        NODE_ID.LABELS,
        NODE_ID.PANEL,
        NODE_ID.INTRO,
      ],
    });
  }

  flyTo(view: MapView): void {
    // Naviguer, c'est vouloir la carte : l'intro, si elle attendait encore, s'ouvre.
    if (this._intro.target < 1) this.drawMap();
    this._terrain.flyTo(view);
  }

  /** Niveau nomme par la carte : communes, departements ou regions (onglets de focus). */
  setFocus(focus: MapFocusId): void {
    this._labels.setFocus(focus);
  }

  /** Interface prevenue du lieu choisi : elle ouvre son fonds et complete son fil d'Ariane. */
  onPlaceSelected(listener: (place: SelectedPlace) => void): () => void {
    this._selectionListeners.add(listener);
    return () => this._selectionListeners.delete(listener);
  }

  searchPlaces(query: string, limit: number): SelectedPlace[] {
    return this._labels.search(query, limit).map(({ name, lon, lat }) => ({ name, lon, lat }));
  }

  /**
   * Vol jusqu'a un lieu : un departement ou une region tient tout entier dans la vue (son contour donne son
   * emprise), une ville arrive de pres. Sans contour connu, on garde l'echelle d'une ville.
   */
  goToPlace({ name, lon, lat }: SelectedPlace): void {
    const rings = this._labels.find(name)?.rings;
    this._terrain.flyTo({ lon, lat, extentKm: rings ? extentOfRings(rings) : Math.min(this._terrain.extentKm, CITY_EXTENT_KM) });
  }

  /** Largeur de la vue et point vise, pour l'echelle et les coordonnees de l'interface. */
  readout(): { extentKm: number; lon: number; lat: number; flying: boolean } {
    const { west, east, south, north } = this._terrain.bounds;
    return { extentKm: this._terrain.extentKm, lon: (west + east) / 2, lat: (south + north) / 2, flying: this._terrain.flying };
  }

  /** L'experience peut partir : le mot de l'intro prend toute son encre. */
  setIntroReady(ready: boolean): void {
    this._intro3d.ready = ready;
  }

  /** Page blanche : la carte se charge, mais rien n'est dessine tant que `drawMap` n'est pas appele. */
  holdIntro(): void {
    this._intro.reveal = 0;
    this._intro.target = 0;
  }

  /** La carte se dessine en s'ouvrant depuis le point vise, puis vole vers `view` si elle est donnee. */
  drawMap(view?: MapView): void {
    this._intro.target = 1;
    if (view) this._terrain.flyTo(view);
  }

  override async beforeMount(): Promise<void> {
    if (!this._nodesRegistered) {
      this.graph.addMany([
        this._cameraNode,
        this._lights,
        this._terrain,
        this._buildings,
        this._planes,
        this._clouds,
        this._survey,
        this._labels,
        this._panel,
        this._intro3d,
      ]);
      this._nodesRegistered = true;
    }
    await Promise.resolve(super.beforeMount());
    const newsprint = this._assets.get<Texture>(ASSET_KEYS.paper.newsprint);
    if (newsprint) newsprintMap.value = newsprint;
  }

  protected override getAssetPreloadGroups(): string[] {
    return ["universe:main"];
  }

  override update(time: number, dt: number): void {
    super.update(time, dt);
    // A l'encre, l'effet plein ecran dessine l'image ; la carte de nuit ne passe par rien.
    this._inkPass.enabled = inkSettings.amount.value > 0.5;
    // Intro : la zone dessinee s'ouvre depuis le point vise. Elle part vite et finit doucement.
    const intro = this._intro;
    if (intro.reveal !== intro.target) {
      const step = dt / INTRO_MS;
      intro.reveal = intro.target > intro.reveal ? Math.min(intro.target, intro.reveal + step) : Math.max(intro.target, intro.reveal - step);
    }
    const eased = intro.reveal * intro.reveal * (3 - 2 * intro.reveal);
    terrainSettings.drawnReveal.value = eased;
    inkSettings.reveal.value = eased;
    // Les noms arrivent apres le trait, une fois la carte bien ouverte.
    this._labels.intro = Math.max(0, eased * 2 - 1);
    // Ce qui vole au-dessus de la carte n'apparait qu'avec elle.
    for (const node of [this._clouds, this._planes, this._survey]) node.getObject3D().visible = eased > 0.02;
    this._lights.relief(terrainSettings.relief.value);
    this._renderStats.update(dt);

    // Au repos, pas d'image nouvelle a chaque rafraichissement : l'ordinateur ne chauffe pas pour une image fixe.
    const camera = (this.camera as Camera).matrixWorld;
    const still =
      camera.elements.every((v, i) => Math.abs(v - this._renderedCamera.elements[i]!) < STILL) &&
      this._terrain.settled &&
      this._buildings.settled &&
      this._labels.settled &&
      this._panel.settled &&
      this._intro3d.settled &&
      terrainSettings.landcoverReveal.value >= 1;
    this._sinceRender += dt;
    // Ce qui bouge tout seul (vehicules, avions, vent dans les arbres) : l'image n'est alors jamais tout a fait
    // immobile, et se redessine a la cadence de veille.
    const lively = this._buildings.lively || this._planes.lively || terrainSettings.wind.value > 0;
    const render = !still || this._sinceRender >= 1000 / (lively ? LIVELY_FPS : IDLE_FPS);
    this._composer.paused = !render;
    if (render) {
      this._sinceRender = 0;
      this._renderedCamera.copy(camera);
    }
    // La cadence ne se juge qu'en mouvement : au repos, les images sautees ne disent rien du cout.
    if (!still) this._quality.update(dt);
  }

  override onMounted(): void {
    super.onMounted();
    void this.applyContract(NODE_ID.CONTRACT_BASE);
    this._settings();
  }

  /** Declare une fois : application toujours, panneau seulement avec `?debug`. */
  private _settings(): void {
    const debug = this._debug;
    if (!debug) return;
    const terrain = this._terrain;
    const camera = this._cameraNode;
    const lights = this._lights;
    const buildings = this._buildings;
    const ink = this._ink;
    const asRecord = (value: object) => value as unknown as Record<string, unknown>;
    type Options = Parameters<typeof debug.bind>[3];
    /** Reglage porte par un uniform (`.value`). */
    const knob = (target: DebugTarget | null, node: object, options: Options, path: string) =>
      debug.bind(target, asRecord(node), "value", options, path);
    const applySun = () => {
      lights.apply();
      lights.directionTo(terrainSettings.sun.value);
    };
    const applyInk = () => {
      const paper = inkSettings.amount.value > 0.5;
      terrainSettings.pen.value = paper ? 1 : 0;
      (this.scene as Scene).background = paper ? inkSettings.paper.value : new Color(BACKGROUND);
      document.documentElement.dataset.mapTheme = paper ? "paper" : "night";
    };

    // Vue : le relief, le plan et la zone dessinee.
    const mask = terrainSettings.maskRadius.value;
    const folder = (
      tabId: (typeof TAB_ID)[keyof typeof TAB_ID],
      folderId: (typeof FOLDER_ID)[keyof typeof FOLDER_ID],
      declare: (target: DebugTarget | null) => { dispose(): void }[],
      after?: () => void,
    ) => {
      const mount = (target: DebugTarget | null) => {
        const bindings = declare(target);
        after?.();
        return () => {
          for (const binding of bindings) binding.dispose();
        };
      };
      mount(null);
      this.debugSubscribe({ tabId, folderId, mount });
    };

    folder(TAB_ID.MAP, FOLDER_ID.VIEW, (target) => [
      debug.bind(target, terrain.settings, "exaggeration", { label: "relief", min: 0.5, max: 12, step: 0.1 }, "terrain.exaggeration"),
      knob(target, terrainSettings.occlusion, { label: "creux", min: 0, max: 5, step: 0.05 }, "terrain.occlusion"),
      knob(target, terrainSettings.mist, { label: "brume", min: 0, max: 1, step: 0.01 }, "terrain.mist"),
      knob(target, terrainSettings.landcoverStrength, { label: "plan", min: 0, max: 1, step: 0.01 }, "terrain.landcover"),
      debug
        .bind(target, terrain.settings, "segments", { label: "subdivisions (max)", options: SEGMENT_OPTIONS }, "terrain.segments")
        .on("change", () => terrain.applySettings()),
      debug
        .bind(target, terrain.settings, "adaptive", { label: "subdivisions selon le relief" }, "terrain.adaptive")
        .on("change", () => terrain.applySettings()),
      knob(target, terrainSettings.simplify, { label: "simplifier au loin (m)", min: 0, max: 30, step: 1 }, "terrain.simplify"),
      debug.bind(target, asRecord(mask), "x", { label: "masque largeur", min: 20, max: 400, step: 1 }, "mask.radiusX"),
      debug.bind(target, asRecord(mask), "y", { label: "masque profondeur", min: 20, max: 400, step: 1 }, "mask.radiusY"),
      knob(target, terrainSettings.maskSoftness, { label: "masque fondu", min: 0.02, max: 1, step: 0.01 }, "mask.softness"),
      knob(target, terrainSettings.maskJitter, { label: "masque bord", min: 0, max: 0.6, step: 0.01 }, "mask.jitter"),
    ]);

    // Vie : ce qui peuple la carte, en part de ce que les donnees proposent.
    const share = { label: "", min: 0, max: 1, step: 0.05 };
    folder(TAB_ID.MAP, FOLDER_ID.LIFE, (target) => [
      debug.bind(
        target,
        buildings.settings,
        "technique",
        {
          label: "bati",
          options: {
            aucun: "none",
            volumes: "extrusion",
          },
        },
        "buildings.technique",
      ),
      debug.bind(target, buildings.settings, "height", { label: "hauteur du bati", min: 0.5, max: 4, step: 0.1 }, "buildings.height"),
      debug.bind(target, buildings.settings, "trees", { ...share, label: "arbres" }, "life.trees"),
      debug.bind(target, buildings.settings, "cars", { ...share, label: "voitures" }, "life.cars"),
      debug.bind(target, buildings.settings, "boats", { ...share, label: "bateaux" }, "life.boats"),
      debug.bind(target, this._planes.settings, "density", { ...share, label: "avions" }, "life.planes"),
      debug.bind(target, this._clouds.settings, "density", { ...share, label: "nuages" }, "life.clouds"),
      debug.bind(target, this._survey.settings, "dustDensity", { ...share, label: "poussiere" }, "life.dust"),
      debug.bind(target, this._survey.settings, "dustSize", { label: "poussiere taille", min: 0.3, max: 3, step: 0.05 }, "life.dustSize"),
      knob(target, terrainSettings.wind, { ...share, label: "vent" }, "life.wind"),
    ]);

    // Camera et soleil : les reglages de mise en scene, rarement touches.
    folder(
      TAB_ID.MAP,
      FOLDER_ID.CAMERA,
      (target) => [
        debug.bind(target, terrain.settings, "ease", { label: "lissage (ms)", min: 0, max: 800, step: 10 }, "camera.ease"),
        debug.bind(target, camera.settings, "tiltNear", { label: "inclinaison de pres", min: 10, max: 75, step: 1 }, "camera.tiltNear"),
        debug.bind(target, camera.settings, "tiltFar", { label: "inclinaison de loin", min: 1, max: 75, step: 1 }, "camera.tiltFar"),
        debug.bind(target, camera.settings, "rollMax", { label: "roulis max", min: 0, max: 0.4, step: 0.01 }, "camera.rollMax"),
        debug.bind(
          target,
          camera.settings,
          "rollPerTurn",
          { label: "roulis / rotation", min: -0.3, max: 0.3, step: 0.005 },
          "camera.rollPerTurn",
        ),
        debug.bind(
          target,
          camera.settings,
          "rollPerPan",
          { label: "roulis / deplacement", min: -0.5, max: 0.5, step: 0.01 },
          "camera.rollPerPan",
        ),
        debug.bind(
          target,
          camera.settings,
          "rollPerMouse",
          { label: "roulis / souris", min: -0.2, max: 0.2, step: 0.005 },
          "camera.rollPerMouse",
        ),
        ...SUN_CONTROLS.map(([key, options]) => debug.bind(target, lights.settings, key, options, `lights.${key}`).on("change", applySun)),
      ],
      applySun,
    );

    // Encre : le trait lui-meme.
    folder(
      TAB_ID.INK,
      FOLDER_ID.INK,
      (target) => [
        ...INK_CONTROLS.map(([key, options]) => knob(target, inkSettings[key], options, `ink.${key}`).on("change", applyInk)),
        knob(target, ink.near, { label: "trait fin des", min: 0, max: 300, step: 1 }, "ink.near"),
        knob(target, ink.far, { label: "trait fin a", min: 10, max: 600, step: 1 }, "ink.far"),
      ],
      applyInk,
    );

    // Papier : le support et ce qui s'y imprime.
    folder(TAB_ID.INK, FOLDER_ID.PAPER, (target) => [
      ...PAPER_CONTROLS.map(([key, options]) =>
        knob(target, inkSettings[key], options, key === "clouds" ? "ink.cloudLines" : `ink.${key}`),
      ),
      knob(target, inkSettings.paper, { label: "papier", color: { type: "float" } }, "ink.paper").on("change", applyInk),
      knob(target, inkSettings.ink, { label: "encre", color: { type: "float" } }, "ink.ink"),
    ]);

    // Ombrage du bati : la marche dans la texture de hauteurs (contours rugueux, ombres, creux).
    folder(TAB_ID.INK, FOLDER_ID.SHADING, (target) =>
      SHADING_CONTROLS.map(([key, options]) => knob(target, terrainSettings[key], options, `shading.${key}`)),
    );

    // Eau : traits paralleles, plus rares vers le large, et leur tremble.
    folder(TAB_ID.INK, FOLDER_ID.WATER, (target) =>
      WATER_CONTROLS.map(([key, options]) => knob(target, terrainSettings[key], options, `water.${key}`)),
    );

    // Lieu survole : l'encre de son trait, et le lavis pose sur son papier.
    folder(TAB_ID.INK, FOLDER_ID.HOVER, (target) => [
      knob(target, inkSettings.hoverInk, { label: "encre du survol", color: { type: "float" } }, "ink.hoverInk"),
      knob(target, inkSettings.hoverWash, { label: "lavis du survol", min: 0, max: 0.6, step: 0.01 }, "ink.hoverWash"),
      knob(target, inkSettings.hoverRim, { label: "trait du perimetre", min: 0, max: 1, step: 0.05 }, "ink.hoverRim"),
    ]);

    // Rendu : ce que la scene coute, et la resolution a laquelle elle est rendue.
    const resolution = this._resolution;
    const quality = this._quality;
    folder(
      TAB_ID.RENDER,
      FOLDER_ID.STATS,
      (target) => [
        ...(target ? this._monitors(target) : []),
        debug
          .bind(target, resolution, "pixelRatio", {
            label: "resolution",
            min: 0.5,
            max: 3,
            step: 0.25,
          })
          .on("change", () => this._renderer.setPixelRatio(resolution.pixelRatio)),
        debug.bind(target, resolution, "auto", { label: "qualite auto" }, "render.auto").on("change", () => {
          quality.enabled = resolution.auto;
        }),
      ],
      () => {
        quality.enabled = resolution.auto;
        terrain.applySettings();
      },
    );
  }

  /** Mesures en lecture seule : cadence, GPU, dessin, et ce que coute le bati. */
  private _monitors(target: DebugTarget): { dispose(): void }[] {
    const frame = this._renderStats.values;
    const buildings = this._buildings.stats;
    const terrain = this._terrain.settings;
    const resolution = this._resolution;
    const readout = {
      get fps() {
        return frame.fps;
      },
      get echelle() {
        return resolution.scene;
      },
      get image() {
        return frame.frameMs;
      },
      get gpu() {
        return frame.gpuMs;
      },
      get dessins() {
        return frame.drawCalls;
      },
      get triangles() {
        return frame.triangles;
      },
      get sol() {
        return (terrain.segments + 1) ** 2;
      },
      get bati() {
        return buildings.vertices;
      },
      get batiments() {
        return buildings.buildings;
      },
      get tuiles() {
        return buildings.tiles;
      },
      get memoire() {
        return buildings.memoryMb;
      },
      get arbres() {
        return buildings.trees;
      },
      get voitures() {
        return buildings.cars;
      },
      get bateaux() {
        return buildings.boats;
      },
    };
    const count = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(2)} M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)} k` : v.toFixed(0));
    const ms = (v: number) => `${v.toFixed(2)} ms`;
    const monitor = (key: keyof typeof readout, label: string, format: (v: number) => string) =>
      target.addBinding(readout, key, { readonly: true, label, format });
    return [
      monitor("fps", "fps", (v) => v.toFixed(0)),
      monitor("image", "image", ms),
      monitor("echelle", "echelle scene", (v) => v.toFixed(2)),
      monitor("gpu", "gpu", (v) => (v ? ms(v) : "-")),
      target.addBinding(readout, "gpu", {
        readonly: true,
        label: "gpu (graphe)",
        view: "graph",
        min: 0,
        max: 16,
      }),
      monitor("dessins", "appels de dessin", count),
      monitor("triangles", "triangles", count),
      monitor("sol", "sommets sol", count),
      monitor("bati", "sommets bati", count),
      monitor("batiments", "batiments", count),
      monitor("tuiles", "tuiles", count),
      monitor("arbres", "arbres", count),
      monitor("voitures", "voitures", count),
      monitor("bateaux", "bateaux", count),
      monitor("memoire", "memoire bati", (v) => `${v.toFixed(1)} Mo`),
    ];
  }
}
