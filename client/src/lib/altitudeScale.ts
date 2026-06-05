const EARTH_RADIUS_KM = 6371;

export function altitudeScale(altKm: number): number {
  return Math.max(0, altKm) / EARTH_RADIUS_KM;
}
