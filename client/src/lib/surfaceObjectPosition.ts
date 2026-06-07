import { altitudeScale, satPos3 } from './altitudeScale';
import type { AircraftState } from '../types/aircraft';
import type { VesselPosition } from '../types/vessel';

export const MIN_AIRCRAFT_REL_ALT = 0.008;
export const VESSEL_REL_ALT = Math.max(altitudeScale(0.05), 0.006);

export interface SurfacePosition {
  x: number;
  y: number;
  z: number;
  relAlt: number;
}

function toSurfacePosition(lat: number, lon: number, relAlt: number): SurfacePosition {
  const [x, y, z] = satPos3(lat, lon, relAlt);
  return { x, y, z, relAlt };
}

export function aircraftSurfacePosition(aircraft: AircraftState): SurfacePosition | null {
  if (aircraft.lat == null || aircraft.lon == null) return null;

  const altitudeM = aircraft.baroAltitude ?? aircraft.geoAltitude ?? 10_000;
  const relAlt = Math.max(altitudeScale(altitudeM / 1000), MIN_AIRCRAFT_REL_ALT);
  return toSurfacePosition(aircraft.lat, aircraft.lon, relAlt);
}

export function vesselSurfacePosition(vessel: VesselPosition): SurfacePosition {
  return toSurfacePosition(vessel.lat, vessel.lon, VESSEL_REL_ALT);
}
