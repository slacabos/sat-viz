import { describe, it, expect } from 'vitest';
import { altitudeScale } from '../lib/altitudeScale';

describe('altitudeScale', () => {
  it('returns 0 for surface level', () => {
    expect(altitudeScale(0)).toBe(0);
  });

  it('clamps negative altitudes to 0', () => {
    expect(altitudeScale(-100)).toBe(0);
  });

  it('ISS at ~400km is ~0.063 globe radii', () => {
    expect(altitudeScale(400)).toBeCloseTo(0.0628, 3);
  });

  it('GEO at 35786km is ~5.6 globe radii', () => {
    expect(altitudeScale(35786)).toBeCloseTo(5.618, 2);
  });

  it('aircraft at 10km is a tiny fraction above surface', () => {
    const alt = altitudeScale(10);
    expect(alt).toBeGreaterThan(0);
    expect(alt).toBeLessThan(0.005);
  });
});
