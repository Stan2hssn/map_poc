import { EventKeyboard } from "@/_core/helpers/event/Input.events";
import type Input from "@_core/systems/Input.ts";
import type { UniverseBase } from "@_core/universes/Universe.base.ts";
import type { UniverseId } from "@graphics/universes/Universe.id.ts";
import { Camera, PerspectiveCamera, Vector3 } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

interface OrbitCameraHelperOptions {
  dampingFactor?: number;
}

export class OrbitCameraHelper {
  private readonly _camera: PerspectiveCamera;
  private readonly _controls: OrbitControls;
  private readonly _direction = new Vector3();
  private readonly _getActiveUniverse: () => UniverseBase<UniverseId> | null;
  private _enabled = false;
  private _tickId: number | null = null;
  private _sourceCamera: Camera | null = null;
  private _sourceUniverse: UniverseBase<UniverseId> | null = null;
  private _unsubscribeKeyDown: (() => void) | null = null;

  constructor(
    domElement: HTMLElement,
    getActiveUniverse: () => UniverseBase<UniverseId> | null,
    options: OrbitCameraHelperOptions = {}
  ) {
    this._getActiveUniverse = getActiveUniverse;
    this._camera = new PerspectiveCamera(
      80,
      globalThis.window?.innerWidth / (globalThis.window?.innerHeight ?? 1),
      0.1,
      100
    );
    this._camera.position.set(0, 2, 4);

    this._controls = new OrbitControls(this._camera, domElement);
    this._controls.enableDamping = true;
    this._controls.dampingFactor = options.dampingFactor ?? 0.12;
    this._controls.enabled = false;
    this._controls.target.set(0, 0, 0);
    this._controls.update();
  }

  get camera(): PerspectiveCamera {
    return this._camera;
  }

  bindInput(input: Input): void {
    this._unsubscribeKeyDown?.();
    this._unsubscribeKeyDown = input.subscribe(EventKeyboard.DOWN, (event) => {
      console.log('keydown');

      if (event.repeat) return;
      if (event[EventKeyboard.SHIFT] && event.code === EventKeyboard.C) {
        this.toggle();
        console.log('toggle');

      }
    });
  }

  toggle(): boolean {
    const activeUniverse = this._getActiveUniverse();
    if (!activeUniverse) return this._enabled;

    if (!this._enabled) {
      const sourceCamera = this._asCamera(activeUniverse.camera);
      if (!sourceCamera) return this._enabled;

      this._sourceUniverse = activeUniverse;
      this._sourceCamera = sourceCamera;
      this.setEnabled(true, sourceCamera);
      activeUniverse.setCamera(this._camera);
      this._enabled = true;
      return this._enabled;
    }

    if (this._sourceUniverse && this._sourceCamera) {
      this._sourceUniverse.setCamera(this._sourceCamera);
    }
    this._sourceUniverse = null;
    this._sourceCamera = null;
    this.setEnabled(false);
    this._enabled = false;
    return this._enabled;
  }

  setEnabled(enabled: boolean, sourceCamera?: Camera): void {
    this._controls.enabled = enabled;
    if (!enabled) {
      this._stopTick();
      return;
    }

    if (sourceCamera) {
      this._camera.position.copy(sourceCamera.position);
      this._camera.quaternion.copy(sourceCamera.quaternion);
      sourceCamera.getWorldDirection(this._direction);
      this._controls.target.copy(this._camera.position).add(this._direction.multiplyScalar(4));
    }

    this._controls.update();
    this._startTick();
  }

  resize(width: number, height: number): void {
    this._camera.aspect = width / height;
    this._camera.updateProjectionMatrix();
  }

  dispose(): void {
    this._unsubscribeKeyDown?.();
    this._unsubscribeKeyDown = null;
    this._sourceUniverse = null;
    this._sourceCamera = null;
    this._enabled = false;
    this._stopTick();
    this._controls.dispose();
  }

  private _asCamera(value: unknown): Camera | null {
    if (!value || typeof value !== "object") return null;
    if (!("isCamera" in value)) return null;
    return value as Camera;
  }

  private _startTick(): void {
    if (this._tickId !== null) return;
    this._tickId = requestAnimationFrame(this._tick);
  }

  private _stopTick(): void {
    if (this._tickId === null) return;
    cancelAnimationFrame(this._tickId);
    this._tickId = null;
  }

  private readonly _tick = (): void => {
    if (!this._controls.enabled) {
      this._tickId = null;
      return;
    }
    this._controls.update();
    this._tickId = requestAnimationFrame(this._tick);
  };
}
