type GsapInstance = typeof import("gsap").default;

let gsapLoader: Promise<GsapInstance> | null = null;

/**
 * Shared lazy loader for GSAP.
 * Keeps GSAP out of the initial chunk while avoiding duplicated loader code.
 */
export function getGsap(): Promise<GsapInstance> {
  gsapLoader = import("gsap").then((mod) => mod.default);
  return gsapLoader;
}
