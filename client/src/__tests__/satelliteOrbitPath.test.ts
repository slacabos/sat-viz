import { describe, expect, it } from 'vitest';
import { SAT_REL_ALT } from '../lib/altitudeScale';
import { buildSatelliteOrbitPath } from '../lib/satelliteOrbitPath';
import type { SatellitePosition, TLERecord } from '../types/satellite';

const ISS_TLE: TLERecord = {
  name: 'ISS (ZARYA)',
  line1: '1 25544U 98067A   24156.52996528  .00018401  00000+0  33219-3 0  9993',
  line2: '2 25544  51.6401 215.0481 0004986 310.8137 197.0690 15.49813782456123',
};

function makeSatellite(overrides: Partial<SatellitePosition> = {}): SatellitePosition {
  return {
    id: 25544,
    name: 'ISS (ZARYA)',
    lat: 0,
    lng: 0,
    altKm: 410,
    inclination: 51.6,
    periodMin: 92.5,
    apogeeKm: 420,
    perigeeKm: 380,
    sampleTimeMs: Date.parse('2024-06-04T12:00:00Z'),
    ...overrides,
  };
}

describe('buildSatelliteOrbitPath', () => {
  it('samples a valid selected satellite orbit path', () => {
    const path = buildSatelliteOrbitPath(
      makeSatellite(),
      ISS_TLE,
      Date.parse('2024-06-04T12:00:00Z'),
      32
    );

    expect(path?.id).toBe(25544);
    expect(path?.points.length).toBeGreaterThan(20);
    for (const point of path?.points ?? []) {
      expect(point.lat).toBeGreaterThanOrEqual(-90);
      expect(point.lat).toBeLessThanOrEqual(90);
      expect(point.lng).toBeGreaterThanOrEqual(-180);
      expect(point.lng).toBeLessThanOrEqual(180);
    }
  });

  it('uses the existing visual shell altitude for the orbit class', () => {
    const path = buildSatelliteOrbitPath(
      makeSatellite({ altKm: 36_000 }),
      ISS_TLE,
      Date.parse('2024-06-04T12:00:00Z'),
      16
    );

    expect(path?.points[0].alt).toBe(SAT_REL_ALT.GEO);
  });

  it('closes the rendered orbit line at the starting point', () => {
    const path = buildSatelliteOrbitPath(
      makeSatellite(),
      ISS_TLE,
      Date.parse('2024-06-04T12:00:00Z'),
      32
    );
    const first = path?.points[0];
    const last = path?.points[path.points.length - 1];

    expect(last).toEqual(first);
  });

  it('returns null for a missing TLE', () => {
    expect(buildSatelliteOrbitPath(makeSatellite(), undefined)).toBeNull();
  });
});
