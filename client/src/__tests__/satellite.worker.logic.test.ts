import { describe, it, expect } from 'vitest';
import {
  degreesLat,
  degreesLong,
  eciToGeodetic,
  gstime,
  propagate,
  twoline2satrec,
  type EciVec3,
} from '../lib/satellite';

// Tests the core satellite.js logic used in the worker without needing the worker itself.

const ISS_LINE1 = '1 25544U 98067A   24156.52996528  .00018401  00000+0  33219-3 0  9993';
const ISS_LINE2 = '2 25544  51.6401 215.0481 0004986 310.8137 197.0690 15.49813782456123';

describe('satellite.js propagation', () => {
  it('parses ISS TLE without error', () => {
    const satrec = twoline2satrec(ISS_LINE1, ISS_LINE2);
    expect(satrec.error).toBe(0);
  });

  it('propagates ISS position to a valid geodetic coordinate', () => {
    const satrec = twoline2satrec(ISS_LINE1, ISS_LINE2);
    const date = new Date('2024-06-04T12:00:00Z');
    const posVel = propagate(satrec, date);

    expect(posVel).not.toBeNull();
    if (!posVel) throw new Error('Expected propagation result');
    expect(typeof posVel.position).not.toBe('boolean');
    const pos = posVel.position as EciVec3<number>;

    const gmst = gstime(date);
    const geo = eciToGeodetic(pos, gmst);

    const lat = degreesLat(geo.latitude);
    const lng = degreesLong(geo.longitude);
    const altKm = geo.height;

    expect(lat).toBeGreaterThanOrEqual(-90);
    expect(lat).toBeLessThanOrEqual(90);
    expect(lng).toBeGreaterThanOrEqual(-180);
    expect(lng).toBeLessThanOrEqual(180);
    // ISS orbits between ~400-420km
    expect(altKm).toBeGreaterThan(350);
    expect(altKm).toBeLessThan(500);
  });

  it('propagate does not throw on bad input — returns a result object', () => {
    const satrec = twoline2satrec(ISS_LINE1, ISS_LINE2);
    // Passing a date far outside the TLE epoch causes degraded accuracy but should not throw
    expect(() => propagate(satrec, new Date('2000-01-01'))).not.toThrow();
  });
});
