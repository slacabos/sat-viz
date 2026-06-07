import { describe, expect, it } from 'vitest';
import { surfaceMarkerTargetPixels, surfaceMarkerWorldScale } from '../lib/surfaceMarkerScale';

describe('surface marker sizing', () => {
  it('uses the far target pixel size at the default globe view distance', () => {
    expect(surfaceMarkerTargetPixels(400)).toBe(18);
    expect(surfaceMarkerTargetPixels(350)).toBe(18);
  });

  it('uses the near target pixel size near the globe surface', () => {
    expect(surfaceMarkerTargetPixels(105)).toBeCloseTo(8, 3);
    expect(surfaceMarkerTargetPixels(100)).toBeCloseTo(8, 3);
  });

  it('smoothly interpolates target pixels between close and far distances', () => {
    const middle = surfaceMarkerTargetPixels(227.5);

    expect(middle).toBeGreaterThan(8);
    expect(middle).toBeLessThan(18);
  });

  it('supports smaller close-range targets for larger surface icon types', () => {
    expect(surfaceMarkerTargetPixels(105, { nearPixels: 5, farPixels: 16 })).toBeCloseTo(5, 3);

    const middle = surfaceMarkerTargetPixels(227.5, { nearPixels: 5, farPixels: 16 });
    expect(middle).toBeGreaterThan(5);
    expect(middle).toBeLessThan(16);
  });

  it('converts target pixels into smaller world scale as the camera gets closer', () => {
    const farScale = surfaceMarkerWorldScale(80, 900, 50, 8, { baseWorldSize: 0.5 });
    const nearScale = surfaceMarkerWorldScale(20, 900, 50, 8, { baseWorldSize: 0.5 });

    expect(nearScale).toBeLessThan(farScale);
    expect(nearScale).toBeLessThan(1);
  });

  it('clamps world scale so markers never grow beyond authored size', () => {
    expect(surfaceMarkerWorldScale(300, 900, 50, 18, { baseWorldSize: 0.5 })).toBe(1);
  });

  it('falls back to authored size for invalid projection inputs', () => {
    expect(surfaceMarkerTargetPixels(Number.NaN)).toBe(18);
    expect(surfaceMarkerWorldScale(Number.NaN, 900, 50, 8, { baseWorldSize: 0.5 })).toBe(1);
  });
});
