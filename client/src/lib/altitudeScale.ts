// Log scale so GEO satellites (~35 800 km) don't render as enormous spikes.
// Results: LEO 400 km → 0.03, MEO 20 000 km → 0.26, GEO 36 000 km → 0.31
// Aircraft at 10 km → ~0.001 (effectively at the surface, same as before).
export function altitudeScale(altKm: number): number {
  if (altKm <= 0) return 0;
  return Math.log10(1 + altKm / 1000) * 0.2;
}
