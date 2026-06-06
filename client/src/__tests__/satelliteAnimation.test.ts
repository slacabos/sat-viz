import { describe, expect, it } from 'vitest';
import {
  clampSampleProgress,
  interpolateLng,
  interpolateShellVector,
  satelliteShellVectors,
} from '../lib/satelliteAnimation';
import type { SatellitePosition } from '../types/satellite';

function makeSatellite(overrides: Partial<SatellitePosition> = {}): SatellitePosition {
  return {
    id: 1,
    name: 'Test Sat',
    lat: 0,
    lng: 0,
    altKm: 400,
    inclination: 51.6,
    ...overrides,
  };
}

function radius(v: ArrayLike<number>) {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}

describe('satellite animation helpers', () => {
  it('clamps sample progress', () => {
    expect(clampSampleProgress(500, 1000, 2000)).toBe(0);
    expect(clampSampleProgress(1500, 1000, 2000)).toBe(0.5);
    expect(clampSampleProgress(2500, 1000, 2000)).toBe(1);
    expect(clampSampleProgress(1500)).toBe(0);
  });

  it('interpolates longitude across the antimeridian via the shortest path', () => {
    expect(interpolateLng(179, -179, 0.5)).toBe(180);
    expect(interpolateLng(-179, 179, 0.5)).toBe(-180);
  });

  it('falls back to the current satellite vector when no target is present', () => {
    const vectors = satelliteShellVectors(makeSatellite(), 0.02);
    expect(vectors.end).toEqual(vectors.start);
  });

  it('keeps interpolated vectors on the visual shell radius', () => {
    const vectors = satelliteShellVectors(makeSatellite({ targetLat: 20, targetLng: 40 }), 0.02);
    const shellRadius = radius(vectors.start);
    const midpoint = interpolateShellVector(vectors.start, vectors.end, shellRadius, 0.5);

    expect(radius(midpoint)).toBeCloseTo(shellRadius, 5);
  });
});
