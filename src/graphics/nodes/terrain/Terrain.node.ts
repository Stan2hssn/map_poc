import { Object3DNodeBase } from "@_core/nodes/object3d/Object3DNode.base.ts";
import { TERRAIN_CONFIG } from "@graphics/config/terrain.config.ts";
import { createTerrainMaterial, terrainSettings } from "@graphics/materials/Terrain.material.ts";
import { SHADOW_CASTERS_LAYER } from "@graphics/nodes/lights/Lights.node.ts";
import { NODE_ID } from "@graphics/nodes/Node.id.ts";
import { createGroundGeometry } from "@graphics/terrain/GroundGeometry.ts";
import type IElevationProvider from "@graphics/terrain/ElevationProvider.interface.ts";
import {
  clampCenter,
  GeoProjection,
  KM_PER_DEGREE,
  WORLD_HEIGHT_KM,
  type GeoBounds,
  type SceneRect,
} from "@graphics/terrain/GeoProjection.ts";
import { flightPath, type FlightPath } from "@graphics/terrain/FlightPath.ts";
import { levelFor } from "@graphics/terrain/HeightMosaic.ts";
import type { MapView } from "@graphics/universes/MapNavigator.interface.ts";
import { INK_PERIOD } from "@graphics/postprocessing/effects/InkStyle.ts";
import { Group, MathUtils, Mesh, Vector2, Vector3, type Camera, type Object3D } from "three";
import { LandcoverHelper } from "./Landcover.helper.ts";
import { TerrainHeightsHelper, type HeightsView } from "./TerrainHeights.helper.ts";

const C = TERRAIN_CONFIG;
// Temps de reponse du plancher et du relief quand la vue change.
const RANGE_EASE_MS = 150;
// Glisse apres un lancer : temps de freinage, et vitesse sous laquelle elle s'arrete (unites par ms).
const GLIDE_MS = 380;
const GLIDE_STOP = 1e-4;
// Cellules de bruit de la brume sur la largeur du bloc (entre 1 et 2 fois ce nombre), et leur derive par seconde.
const MIST_CELLS = 3;
const MIST_DRIFT = { x: 0.004, y: 0.0025 };
// Pseudo-pixels d'encre par cellule de brume : 3 a 6 cellules sur la largeur de la vue.
const INK_CELL_PX = 600;
/** Ordre de dessin du sol : apres le bati (voir `BuildingsNode`), qui le cache en partie. */
export const GROUND_RENDER_ORDER = 1e6;
const EDGE = new Vector3();
/** Contour de la zone dessinee projete a l'ecran : points par tour, et marge autour (fraction de l'ecran). */
const GRID_FIT = { points: 48, margin: 0.03 };
/** Part de la vue reellement dessinee (la zone dessinee occupe un peu moins que le bloc). */
const DRAWN_SHARE = 0.95;
/** Subdivisions de la grille de la passe d'ombre, au plus. */
const CASTER_SEGMENTS = 192;
/**
 * Vols : ampleur du dezoome (`rho` de van Wijk et Nuij ; Mapbox 1,42, ici plus plat : Marseille-Paris culmine
 * vers 200 km de large au lieu de la France entiere), et duree selon la longueur du chemin.
 */
const FLIGHT = { rho: 0.8, ms: 400, msPerStep: 230, minMs: 900, maxMs: 3200 };

/**
 * Subdivisions selon le relief : grille d'echantillons, creux moyen (unites de scene) d'un terrain plat et d'un
 * terrain accidente, paliers de subdivisions, et plancher des qu'une cote traverse la vue.
 */
const ROUGHNESS = { grid: 16, flat: 0.3, steep: 2.5, levels: [256, 512, 1024], coast: 1024 };

/**
 * Sol plein ecran, fixe dans la scene, fenetre sur le terrain : glisser deplace le centre (avec
 * glisse au relacher), la molette change la largeur de la zone de detail (le carre central).
 * Au-dela d'une demi-circonference, elle s'aplatit en profondeur jusqu'au monde entier (2:1).
 */
export class TerrainNode extends Object3DNodeBase {
  readonly center: { lon: number; lat: number } = { ...C.center };
  /** Zone de detail maximale (carre), pour cadrer la camera. */
  readonly rect: SceneRect;
  /** `ease` : temps de reponse (ms) de la vue affichee vers la vue visee par les gestes (0 : immediat). */
  readonly settings = { segments: C.segments as number, adaptive: true, exaggeration: 2.5, ease: C.easeMs as number };
  extentKm: number = C.extentKm;
  /** Vitesse du centre de la vue affichee (unites de scene par seconde, x a l'est, z au sud) : la camera y penche. */
  readonly velocity = { x: 0, z: 0 };
  /** Incremente a chaque changement de vue. */
  viewVersion = 0;
  /** Camera depuis laquelle la grille de l'ecran est projetee sur le sol. */
  projectFrom: (() => Camera) | null = null;
  /** Axe de la vue au sol (sans parallaxe ni roulis) : la zone dessinee s'y aligne. */
  lookAxis: ((into: Vector2) => Vector2) | null = null;
  /** Texture de donnees, hauteurs et volumes du bati. */
  readonly landcover = new LandcoverHelper();
  /** Dessiner aussi les hauteurs du bati (bati en relief a l'ecran). */
  withBuildingHeights = false;
  private readonly _mesh: Mesh;
  /** Grille du sol dans la passe d'ombre. */
  private readonly _caster: Mesh;
  private readonly _blockSpace = new Group();
  private readonly _heights: TerrainHeightsHelper;
  private _projection = new GeoProjection(this.center.lon, this.center.lat);
  private _bounds: GeoBounds = this._projection.bounds(this.extentKm);
  /** Profondeur du bloc rapportee a sa largeur. */
  private _depth = 1;
  private _level = 0;
  private _segments = 0;
  private _wanted = 0;
  private _segmentsVersion = "";
  /** Altitudes (m) min et max sous le bloc : cible, et valeurs lissees affichees. */
  private _range: { min: number; max: number } | null = null;
  private _rangeVersion = -1;
  private _floor = 0;
  private _relief = 0;
  private readonly _glide = { x: 0, z: 0 };
  /** Vue visee par les gestes : la vue affichee la rattrape (`_ease`), comme la camera de Chartogne-Taillet. */
  private readonly _goal = { lon: C.center.lon, lat: C.center.lat, extentKm: C.extentKm as number };
  private _flight: {
    from: MapView;
    to: MapView;
    destination: HeightsView;
    path: FlightPath;
    duration: number;
    elapsed: number;
  } | null = null;

  constructor(provider: IElevationProvider) {
    const mesh = new Mesh(undefined, createTerrainMaterial());
    super(NODE_ID.TERRAIN, "Terrain", mesh);
    const half = C.blockSize / 2;
    this.rect = { minX: -half, maxX: half, minZ: -half, maxZ: half };
    this._mesh = mesh;
    this._caster = new Mesh(undefined, mesh.material);
    this._heights = new TerrainHeightsHelper(provider);
    // La grille est placee dans la scene par le shader : pas de transformation, pas de culling.
    mesh.frustumCulled = false;
    this._blockSpace.position.set(-half, 0, -half);
    this._blockSpace.scale.set(C.blockSize, 1, C.blockSize);
    mesh.receiveShadow = true;
    // Ombres portees par une grille plus grossiere, rendue seulement dans leur passe : le relief y est lisse, et la
    // grille de l'image (512 et plus) y coutait autant que dans l'image.
    this._caster.frustumCulled = false;
    this._caster.castShadow = true;
    this._caster.layers.set(SHADOW_CASTERS_LAYER);
    mesh.add(this._caster);
    // Dessine apres le bati : le test de profondeur ecarte alors le sol cache sous lui avant son shader, couteux.
    mesh.renderOrder = GROUND_RENDER_ORDER;
    this._setView();
    this.applySettings();
    this._syncGoal();
  }

  /** km par unite de scene. */
  get kmPerUnit(): number {
    return this.extentKm / C.blockSize;
  }

  /**
   * Unites de scene par metre d'altitude. L'exageration suit la racine de la largeur :
   * les grandes vues ne s'aplatissent pas, les petites ne se herissent pas.
   */
  get heightScale(): number {
    const scale = (0.001 / this.kmPerUnit) * this.settings.exaggeration * Math.sqrt(this.extentKm / C.referenceExtentKm);
    return Math.min(scale, C.maxRelief / Math.max(this._relief, 1));
  }

  get bounds(): GeoBounds {
    return this._bounds;
  }

  /** Zone de detail dans la scene. */
  get detailRect(): SceneRect {
    const half = C.blockSize / 2;
    return { minX: -half, maxX: half, minZ: -half * this._depth, maxZ: half * this._depth };
  }

  get pendingCount(): number {
    return this._heights.pendingCount;
  }

  get flying(): boolean {
    return !!this._flight;
  }

  /** Plus rien ne bouge : ni vol, ni glisse, ni vue qui rattrape la visee, ni relief qui se pose. */
  get settled(): boolean {
    const g = this._goal;
    const r = this._range;
    const easing = g.lon !== this.center.lon || g.lat !== this.center.lat || g.extentKm !== this.extentKm;
    const gliding = Math.hypot(this._glide.x, this._glide.z) >= GLIDE_STOP;
    const rising = !!r && (Math.abs(r.min - this._floor) > 0.5 || Math.abs(r.max - r.min - this._relief) > 0.5);
    return !this._flight && !easing && !gliding && !rising;
  }

  /** Arrivee du vol en cours (emprise et largeur) : les donnees se chargent pour elle, pas pour les vues traversees. */
  get destination(): { bounds: GeoBounds; extentKm: number } | null {
    const f = this._flight;
    return f ? { bounds: f.destination.bounds, extentKm: f.to.extentKm } : null;
  }

  /** Position (unites de scene) d'un point geographique, meme hors du bloc. */
  sceneOf(lon: number, lat: number): { x: number; z: number } {
    const k = this.kmPerUnit;
    return { x: this._projection.x(lon) / k, z: this._projection.z(lat) / k };
  }

  /** Point geographique d'une position de la scene : l'inverse de `sceneOf`. */
  geoOf(x: number, z: number): { lon: number; lat: number } {
    const k = this.kmPerUnit;
    return { lon: this._projection.lon(x * k), lat: this._projection.lat(z * k) };
  }

  /** Place les uv de la zone de detail (0..1) dans la scene. */
  get block(): Object3D {
    return this._blockSpace;
  }

  /** Deplace le centre vise de (dx, dz) unites de scene (celles de la vue affichee). */
  moveBy(dx: number, dz: number): void {
    this._flight = null;
    this._glide.x = this._glide.z = 0;
    this._moveGoal(dx * this.kmPerUnit, dz * this.kmPerUnit);
  }

  /** Change la largeur visee ; le terrain affiche sous le point (x, z) de la scene y sera encore a l'arrivee. */
  zoomAt(factor: number, x: number, z: number): void {
    this._flight = null;
    const k = this.kmPerUnit;
    const anchor = new GeoProjection(this._projection.lon(x * k), this._projection.lat(z * k));
    const g = this._goal;
    g.extentKm = MathUtils.clamp(g.extentKm * factor, C.minExtentKm, C.maxExtentKm);
    const next = g.extentKm / C.blockSize;
    this._setGoal(anchor.lon(-x * next), anchor.lat(-z * next));
  }

  /** Lance le terrain (unites de scene par ms) ; il glisse puis freine. */
  fling(vx: number, vz: number): void {
    this._glide.x = vx;
    this._glide.z = vz;
  }

  /** Vol vers une vue ; s'il va loin, il dezoome juste assez pour garder depart et arrivee en vue (`flightPath`). */
  flyTo(view: MapView): void {
    this._glide.x = this._glide.z = 0;
    const from = { ...this.center, extentKm: this.extentKm };
    const to = { ...view, extentKm: MathUtils.clamp(view.extentKm, C.minExtentKm, C.maxExtentKm) };
    const distanceKm = Math.hypot(new GeoProjection(from.lon, from.lat).x(to.lon), (to.lat - from.lat) * KM_PER_DEGREE);
    const path = flightPath(from.extentKm, to.extentKm, distanceKm, FLIGHT.rho);
    const duration = MathUtils.clamp(FLIGHT.ms + path.length * FLIGHT.msPerStep, FLIGHT.minMs, FLIGHT.maxMs);
    this._flight = { from, to, destination: this._viewOf(to), path, duration, elapsed: 0 };
  }

  /** Pose la vue sans vol : l'intro l'installe sous sa page, rien ne doit y voyager. */
  jumpTo(view: MapView): void {
    this._flight = null;
    this._glide.x = this._glide.z = 0;
    Object.assign(this.center, { lon: view.lon, lat: view.lat });
    this.extentKm = MathUtils.clamp(view.extentKm, C.minExtentKm, C.maxExtentKm);
    this._setView();
    this._syncGoal();
  }

  /** Altitude affichee (unites de scene) au point (x, z) de la scene. */
  heightAt(x: number, z: number): number {
    const k = this.kmPerUnit;
    const height = this._heights.heightAt(this._projection.lon(x * k), this._projection.lat(z * k));
    return (height - this._floor) * this.heightScale;
  }

  /**
   * Subdivisions que le relief en vue demande, au plus `settings.segments`. Un plateau (Aix) n'a rien a montrer
   * qu'une grille lache ne rende deja ; une cote ou une vallee, si. Mesure : creux moyen sur une grille grossiere
   * d'altitudes (difference seconde, en unites de scene), plus un plancher des qu'un trait de cote traverse la vue.
   */
  private _wantedSegments(): number {
    const max = this.settings.segments;
    if (!this.settings.adaptive) return max;
    const n = ROUGHNESS.grid;
    const span = this.rect.maxX - this.rect.minX;
    const at = (i: number, j: number) => this.heightAt(this.rect.minX + (i / n) * span, this.rect.minZ + (j / n) * span);
    let curvature = 0;
    let land = 0;
    let samples = 0;
    for (let j = 1; j < n; j++) {
      for (let i = 1; i < n; i++) {
        const [h, west, east, north, south] = [at(i, j), at(i - 1, j), at(i + 1, j), at(i, j - 1), at(i, j + 1)];
        curvature += Math.abs(west + east - 2 * h) + Math.abs(north + south - 2 * h);
        land += h > 0 ? 1 : 0;
        samples++;
      }
    }
    const rough = samples > 0 ? curvature / samples : 0;
    const detail = MathUtils.clamp(Math.log2(rough / ROUGHNESS.flat) / Math.log2(ROUGHNESS.steep / ROUGHNESS.flat), 0, 1);
    // Cote en vue (de la terre et de l'eau) : le trait de cote se dessine sur la grille, il lui faut des sommets.
    const coast = land > 0 && land < samples;
    const wanted = ROUGHNESS.levels[Math.round(detail * (ROUGHNESS.levels.length - 1))]!;
    return Math.min(max, Math.max(wanted, coast ? ROUGHNESS.coast : 0));
  }

  applySettings(): void {
    // La mesure coute 300 lectures d'altitude : seulement quand la vue ou le relief a change.
    const version = `${this.viewVersion}/${this._heights.version}/${this.settings.segments}/${this.settings.adaptive}`;
    if (version !== this._segmentsVersion) {
      this._segmentsVersion = version;
      this._wanted = this._wantedSegments();
    }
    const wanted = this._wanted;
    if (wanted === this._segments) return;
    this._segments = wanted;
    this._mesh.geometry.dispose();
    this._mesh.geometry = createGroundGeometry(this._segments);
    this._caster.geometry.dispose();
    this._caster.geometry = createGroundGeometry(Math.min(this._segments, CASTER_SEGMENTS));
    this._setView();
  }

  // L'apercu est attendu : le bloc n'apparait pas a plat.
  override async beforeMount(): Promise<void> {
    if (this._heights.ready) return;
    this._heights.update(this._view());
    // Donnees du sol demandees tout de suite, en parallele du relief plutot qu'apres lui.
    this.landcover.update(this._bounds, this.withBuildingHeights);
    const deadline = performance.now() + 5000;
    while (!this._heights.coarseLoaded(this._bounds, this._level) && performance.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    this._heights.update(this._view());
    this._easeRange(Infinity);
    this._syncUniforms();
  }

  override update(_time: number, dt: number): void {
    const { lon, lat } = this.center;
    this._fly(dt);
    this._glideStep(dt);
    this._ease(dt);
    this._measureVelocity(lon, lat, dt);
    this._heights.update(this._view(), this._flight?.destination);
    this.landcover.update(this._bounds, this.withBuildingHeights, this._landcoverTarget(), !this.settled);
    this._easeRange(dt);
    // Grille allegee la ou le relief ne demande rien ; jamais pendant un vol, ou la refaire sauterait.
    if (this.settled) this.applySettings();
    terrainSettings.clock.value += dt / 1000;
    terrainSettings.mistDrift.value.x += (MIST_DRIFT.x * dt) / 1000;
    terrainSettings.mistDrift.value.y += (MIST_DRIFT.y * dt) / 1000;
    this._syncUniforms();
  }

  override dispose(): void {
    this._heights.dispose();
    this.landcover.dispose();
    terrainSettings.mistNoise.value.dispose();
    this._mesh.geometry.dispose();
    (this._mesh.material as { dispose(): void }).dispose();
    super.dispose();
  }

  private _moveGoal(dxKm: number, dzKm: number): void {
    const from = new GeoProjection(this._goal.lon, this._goal.lat);
    this._setGoal(from.lon(dxKm), from.lat(dzKm));
  }

  /** Centre vise, borne comme `_setView` bornera la vue affichee : sans quoi elle ne l'atteindrait jamais. */
  private _setGoal(lon: number, lat: number): void {
    Object.assign(this._goal, this._viewOf({ lon, lat, extentKm: this._goal.extentKm }).center);
  }

  private _syncGoal(): void {
    Object.assign(this._goal, this.center, { extentKm: this.extentKm });
  }

  /** La vue affichee rattrape la vue visee, en `settings.ease` ms environ (lissage de Chartogne-Taillet). */
  private _ease(dt: number): void {
    if (this._flight) return;
    const g = this._goal;
    const zoom = Math.log(g.extentKm / this.extentKm);
    const east = (g.lon - this.center.lon) * Math.cos(MathUtils.degToRad(this.center.lat)) * KM_PER_DEGREE;
    const north = (g.lat - this.center.lat) * KM_PER_DEGREE;
    if (zoom === 0 && east === 0 && north === 0) return;
    // Arrivee a un dix-millieme de la vue pres : on se pose, plus de nouvelle vue a chaque image.
    const k =
      Math.abs(zoom) < 1e-4 && Math.hypot(east, north) < this.extentKm * 1e-4 ? 1 : 1 - Math.exp(-dt / Math.max(this.settings.ease, 1));
    this.center.lon += (g.lon - this.center.lon) * k;
    this.center.lat += (g.lat - this.center.lat) * k;
    this.extentKm = k === 1 ? g.extentKm : this.extentKm * Math.exp(zoom * k);
    this._setView();
  }

  private _measureVelocity(lon: number, lat: number, dt: number): void {
    const perSecond = dt > 0 ? 1000 / (dt * this.kmPerUnit) : 0;
    this.velocity.x = (this.center.lon - lon) * Math.cos(MathUtils.degToRad(lat)) * KM_PER_DEGREE * perSecond;
    this.velocity.z = (lat - this.center.lat) * KM_PER_DEGREE * perSecond;
  }

  private _glideStep(dt: number): void {
    const g = this._glide;
    if (Math.hypot(g.x, g.z) < GLIDE_STOP) return;
    this._moveGoal(g.x * dt * this.kmPerUnit, g.z * dt * this.kmPerUnit);
    const k = Math.exp(-dt / GLIDE_MS);
    g.x *= k;
    g.z *= k;
  }

  private _fly(dt: number): void {
    const f = this._flight;
    if (!f) return;
    f.elapsed += dt;
    const t = Math.min(1, f.elapsed / f.duration);
    // Depart et arrivee adoucis au carre (`power2.inOut` de Chartogne-Taillet) : le chemin a deja une vitesse percue constante.
    const s = (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) ** 2) * f.path.length;
    const u = t === 1 ? 1 : f.path.progress(s);
    this.center.lon = MathUtils.lerp(f.from.lon, f.to.lon, u);
    this.center.lat = MathUtils.lerp(f.from.lat, f.to.lat, u);
    this.extentKm = MathUtils.clamp(t === 1 ? f.to.extentKm : f.path.width(s), C.minExtentKm, C.maxExtentKm);
    if (t === 1) this._flight = null;
    this._setView();
    // Un geste pendant ou apres le vol repart de la vue affichee.
    this._syncGoal();
  }

  /**
   * Donnees du sol a charger pendant un vol : autour de l'arrivee, a la largeur de la vue du moment (sinon la
   * descente montre le seul carre de l'arrivee) ; une nouvelle image a chaque palier de zoom franchi.
   */
  private _landcoverTarget(): GeoBounds | undefined {
    const f = this._flight;
    if (!f) return undefined;
    return this._viewOf({ ...f.to, extentKm: Math.max(this.extentKm, f.to.extentKm) }).bounds;
  }

  private _view(): HeightsView {
    return { bounds: this._bounds, level: this._level, center: this.center };
  }

  /** Vue d'arrivee d'un vol, bornee comme `_setView` la bornera. */
  private _viewOf({ lon, lat, extentKm }: MapView): HeightsView {
    const heightKm = Math.min(extentKm, WORLD_HEIGHT_KM);
    // Vue large : le centre se resserre pour que la zone dessinee reste dans les donnees de relief, bord compris.
    const half = (heightKm / 2 / KM_PER_DEGREE) * DRAWN_SHARE;
    const { north, south } = C.centerBounds;
    const middle = (north + south) / 2;
    const limits =
      north - half >= south + half
        ? { ...C.centerBounds, north: north - half, south: south + half }
        : { ...C.centerBounds, north: middle, south: middle };
    const center = clampCenter(lon, lat, extentKm, heightKm, limits);
    const bounds = new GeoProjection(center.lon, center.lat).bounds(extentKm, heightKm);
    return { bounds, level: levelFor(extentKm, this._segments || C.segments, C.maxZoom), center };
  }

  private _setView(): void {
    const view = this._viewOf({ ...this.center, extentKm: this.extentKm });
    Object.assign(this.center, view.center);
    this._projection = new GeoProjection(this.center.lon, this.center.lat);
    this._bounds = view.bounds;
    this._level = view.level;
    this._depth = Math.min(this.extentKm, WORLD_HEIGHT_KM) / this.extentKm;
    this._blockSpace.scale.z = C.blockSize * this._depth;
    this._blockSpace.position.z = (-C.blockSize * this._depth) / 2;
    this._range = null;
    this.viewVersion++;
  }

  private _syncUniforms(): void {
    const s = terrainSettings;
    const camera = this.projectFrom?.();
    if (camera) {
      camera.updateMatrixWorld();
      s.viewWorld.value.copy(camera.matrixWorld);
      s.viewProjectionInverse.value.copy(camera.projectionMatrixInverse);
      s.viewOrigin.value.setFromMatrixPosition(camera.matrixWorld);
      this.lookAxis?.(s.maskAxis.value);
      const { fromKm, toKm, scale } = C.mask.widen;
      const widen = 1 + (scale - 1) * MathUtils.clamp(Math.log(this.extentKm / fromKm) / Math.log(toKm / fromKm), 0, 1);
      // Bornee au sol : au-dela, la zone dessinee irait chercher des donnees qui s'arretent, et on verrait le bord.
      s.maskScale.value = Math.min(widen, C.mask.reach / Math.max(s.maskRadius.value.x, s.maskRadius.value.y));
      this._fitGrid(camera);
    }
    const b = this._bounds;
    s.heightScale.value = this.heightScale;
    s.floor.value = this._floor;
    s.relief.value = this._relief;
    s.blockSize.value.set(C.blockSize, C.blockSize * this._depth);
    const cos = Math.cos(MathUtils.degToRad(this.center.lat));
    s.geoOrigin.value.set(b.west, b.north);
    s.geoSize.value.set(b.east - b.west, b.south - b.north);
    s.geoCos.value = cos;
    const octave = Math.log2((b.east - b.west) * cos);
    const scale = MIST_CELLS * 2 ** -Math.floor(octave);
    s.mistScales.value.set(scale, scale / 2);
    s.mistBlend.value = octave - Math.floor(octave);
    // Encre accrochee a la carte, aux echelles de la brume : origine recalee d'une periode entiere,
    // en double precision ici, pour que le shader ne manipule que de petits ecarts.
    const [near, next] = [scale * INK_CELL_PX, (scale / 2) * INK_CELL_PX];
    const origin = (f: number, g: number) => g - Math.floor((g * f) / INK_PERIOD) * (INK_PERIOD / f);
    const [x, y] = [b.west * cos, b.north];
    s.inkScale.value.set(near, next);
    s.inkOrigin.value.set(origin(near, x), origin(near, y), origin(next, x), origin(next, y));
  }

  /**
   * A l'encre, la grille du sol ne couvre que le rectangle de l'ecran ou se projette la zone dessinee (bord
   * irregulier et relief compris) : ailleurs le sol serait efface en papier, inutile de le calculer. Ses sommets
   * s'y concentrent d'autant.
   */
  private _fitGrid(camera: Camera): void {
    const s = terrainSettings;
    const rect = s.screenRect.value;
    if (s.pen.value < 0.5) {
      rect.set(0, 0, 1, 1);
      return;
    }
    const axis = s.maskAxis.value;
    const grow = (1 + s.maskJitter.value / 2) * s.maskScale.value;
    const [across, along] = [s.maskRadius.value.x * grow, s.maskRadius.value.y * grow];
    const top = this._relief * this.heightScale;
    let [x0, y0, x1, y1] = [1, 1, 0, 0];
    let behind = false;
    for (let i = 0; i < GRID_FIT.points; i++) {
      const angle = (i / GRID_FIT.points) * Math.PI * 2;
      const [u, v] = [Math.cos(angle) * across, Math.sin(angle) * along];
      // En travers du regard puis le long : les axes du masque (voir `drawnMask`), autour du point vise.
      const x = u * axis.y + v * axis.x;
      const z = -u * axis.x + v * axis.y;
      for (const y of [0, top]) {
        EDGE.set(x, y, z).applyMatrix4(camera.matrixWorldInverse);
        if (EDGE.z > -0.5) {
          behind = true;
          continue;
        }
        EDGE.applyMatrix4(camera.projectionMatrix);
        const [sx, sy] = [(EDGE.x + 1) / 2, (EDGE.y + 1) / 2];
        [x0, y0, x1, y1] = [Math.min(x0, sx), Math.min(y0, sy), Math.max(x1, sx), Math.max(y1, sy)];
      }
    }
    // Zone qui passe derriere la camera : elle touche le bas de l'ecran, sur toute sa largeur.
    if (behind) [x0, y0, x1] = [0, 0, 1];
    const m = GRID_FIT.margin;
    rect.set(Math.max(0, x0 - m), Math.max(0, y0 - m), Math.min(1, x1 + m), Math.min(1, y1 + m));
  }

  private _easeRange(dt: number): void {
    if (this._rangeVersion !== this._heights.version) this._range = null;
    this._rangeVersion = this._heights.version;
    this._range ??= this._heights.range(this._bounds);
    if (!this._range) return;
    const k = 1 - Math.exp(-dt / RANGE_EASE_MS);
    this._floor += (this._range.min - this._floor) * k;
    this._relief += (this._range.max - this._range.min - this._relief) * k;
  }
}
