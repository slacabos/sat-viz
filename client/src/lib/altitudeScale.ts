// Log scale so GEO satellites (~35 800 km) don't render as enormous spikes.
// Results: LEO 400 km → 0.03, MEO 20 000 km → 0.26, GEO 36 000 km → 0.31
// Aircraft at 10 km → ~0.001 (effectively at the surface, same as before).
export function altitudeScale(altKm: number): number {
  if (altKm <= 0) return 0;
  return Math.log10(1 + altKm / 1000) * 0.2;
}

// Satellite orbit classification thresholds (km) — must match GlobeView shell values.
export type OrbitClass = 'LEO' | 'MEO' | 'GEO';

export function classifyOrbit(altKm: number): OrbitClass {
  if (altKm >= 35000) return 'GEO';
  if (altKm >= 2000) return 'MEO';
  return 'LEO';
}

// Fixed shell altitudes (relative units) used for rendering — snaps satellites to discrete
// visual shells so the globe stays readable regardless of exact altitude.
export const SAT_REL_ALT: Record<OrbitClass, number> = { LEO: 0.02, MEO: 0.06, GEO: 0.14 };

const DEG2RAD = Math.PI / 180;
export const GLOBE_RADIUS = 100; // three-globe default

// Convert lat/lng/relAlt to globe-local Cartesian coordinates.
// Matches three-globe's internal polar2Cartesian so instances align with
// what react-globe.gl positions for other layers.
export function satPos3(lat: number, lng: number, relAlt: number): [number, number, number] {
  const phi = (90 - lat) * DEG2RAD;
  const theta = (90 - lng) * DEG2RAD;
  const r = GLOBE_RADIUS * (1 + relAlt);
  const sinPhi = Math.sin(phi);
  return [r * sinPhi * Math.cos(theta), r * Math.cos(phi), r * sinPhi * Math.sin(theta)];
}
