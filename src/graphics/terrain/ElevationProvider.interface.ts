export default interface IElevationProvider {
  /**
   * 256 x 256 altitudes en metres, ligne 0 au nord, NaN sans donnee.
   * `null` : aucune source a ce niveau, le niveau parent sert a la place.
   */
  fetchTile(z: number, x: number, y: number, signal: AbortSignal): Promise<Float32Array | null>;
}
