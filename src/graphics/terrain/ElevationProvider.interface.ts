export default interface IElevationProvider {
  /** 256 x 256 altitudes en metres, ligne 0 au nord ; 0 sans donnee. */
  fetchTile(z: number, x: number, y: number, signal: AbortSignal): Promise<Float32Array>;
}
