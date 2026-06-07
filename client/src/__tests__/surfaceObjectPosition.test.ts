import { describe, expect, it } from 'vitest';
import { GLOBE_RADIUS, altitudeScale, satPos3 } from '../lib/altitudeScale';
import {
  aircraftSurfacePosition,
  MIN_AIRCRAFT_REL_ALT,
  VESSEL_REL_ALT,
  vesselSurfacePosition,
} from '../lib/surfaceObjectPosition';
import type { AircraftState } from '../types/aircraft';
import type { VesselPosition } from '../types/vessel';

function makeAircraft(overrides: Partial<AircraftState> = {}): AircraftState {
  return {
    icao24: 'abc123',
    callsign: null,
    originCountry: 'United Kingdom',
    lon: -0.1,
    lat: 51.5,
    baroAltitude: 10_000,
    onGround: false,
    velocity: 200,
    trueTrack: 90,
    verticalRate: 0,
    geoAltitude: null,
    ...overrides,
  };
}

function makeVessel(overrides: Partial<VesselPosition> = {}): VesselPosition {
  return {
    mmsi: '111',
    shipName: 'Ship 111',
    lat: 51.5,
    lon: -0.1,
    sog: 10,
    cog: 90,
    heading: 90,
    shipType: 70,
    lastUpdate: Date.now(),
    ...overrides,
  };
}

describe('surface object positions', () => {
  it('uses the aircraft minimum relative altitude for very low aircraft', () => {
    const position = aircraftSurfacePosition(makeAircraft({ baroAltitude: 0, geoAltitude: null }));

    expect(position?.relAlt).toBe(MIN_AIRCRAFT_REL_ALT);
  });

  it('uses scaled aircraft altitude when above the minimum', () => {
    const position = aircraftSurfacePosition(makeAircraft({ baroAltitude: 100_000 }));

    expect(position?.relAlt).toBeCloseTo(altitudeScale(100), 6);
  });

  it('returns null for aircraft without complete coordinates', () => {
    expect(aircraftSurfacePosition(makeAircraft({ lat: null }))).toBeNull();
    expect(aircraftSurfacePosition(makeAircraft({ lon: null }))).toBeNull();
  });

  it('matches satPos3 coordinates for aircraft', () => {
    const aircraft = makeAircraft({ lat: 0, lon: 90, baroAltitude: 0 });
    const position = aircraftSurfacePosition(aircraft);
    const [x, y, z] = satPos3(0, 90, MIN_AIRCRAFT_REL_ALT);

    expect(position).toMatchObject({
      x: expect.closeTo(x, 6),
      y: expect.closeTo(y, 6),
      z: expect.closeTo(z, 6),
    });
  });

  it('uses the fixed vessel surface altitude', () => {
    const position = vesselSurfacePosition(makeVessel());

    expect(position.relAlt).toBe(VESSEL_REL_ALT);
    expect(
      Math.sqrt(position.x * position.x + position.y * position.y + position.z * position.z)
    ).toBeCloseTo(GLOBE_RADIUS * (1 + VESSEL_REL_ALT), 6);
  });
});
