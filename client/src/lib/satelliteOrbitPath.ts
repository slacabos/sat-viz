import {
  degreesLat,
  degreesLong,
  eciToGeodetic,
  gstime,
  propagate,
  twoline2satrec,
  type EciVec3,
} from './satellite';
import { classifyOrbit, SAT_REL_ALT } from './altitudeScale';
import type { SatellitePosition, TLERecord } from '../types/satellite';

const DEFAULT_SAMPLE_COUNT = 220;

export interface OrbitPathPoint {
  lat: number;
  lng: number;
  alt: number;
}

export interface OrbitPath {
  id: number;
  points: OrbitPathPoint[];
}

export function buildSatelliteOrbitPath(
  satellite: SatellitePosition,
  tle: TLERecord | undefined,
  startTimeMs = satellite.sampleTimeMs ?? Date.now(),
  sampleCount = DEFAULT_SAMPLE_COUNT
): OrbitPath | null {
  if (!tle || sampleCount < 8) return null;

  const satrec = twoline2satrec(tle.line1, tle.line2);
  if (satrec.error !== 0 || satrec.no <= 0) return null;

  const periodMs = (2 * Math.PI * 60_000) / satrec.no;
  const relAlt = SAT_REL_ALT[classifyOrbit(satellite.altKm)];
  const points: OrbitPathPoint[] = [];
  const fixedGmst = gstime(new Date(startTimeMs));

  for (let i = 0; i <= sampleCount; i++) {
    const date = new Date(startTimeMs + (periodMs * i) / sampleCount);
    const posVel = propagate(satrec, date);
    if (!posVel || typeof posVel.position === 'boolean') continue;

    const geo = eciToGeodetic(posVel.position as EciVec3<number>, fixedGmst);
    const lat = degreesLat(geo.latitude);
    const lng = degreesLong(geo.longitude);

    if (Number.isNaN(lat) || Number.isNaN(lng)) continue;
    points.push({ lat, lng, alt: relAlt });
  }

  if (points.length >= 2) {
    points[points.length - 1] = { ...points[0] };
  }

  return points.length >= 2 ? { id: satellite.id, points } : null;
}
