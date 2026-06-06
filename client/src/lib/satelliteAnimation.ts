import { satPos3 } from './altitudeScale';
import type { SatellitePosition } from '../types/satellite';

export const SATELLITE_RENDER_FPS = 30;
export const SATELLITE_FRAME_MS = 1000 / SATELLITE_RENDER_FPS;

export function clampSampleProgress(nowMs: number, sampleTimeMs?: number, targetTimeMs?: number) {
  if (sampleTimeMs == null || targetTimeMs == null || targetTimeMs <= sampleTimeMs) return 0;
  return Math.min(1, Math.max(0, (nowMs - sampleTimeMs) / (targetTimeMs - sampleTimeMs)));
}

export function interpolateLng(startLng: number, endLng: number, progress: number) {
  let delta = endLng - startLng;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  const lng = startLng + delta * progress;
  if (lng > 180) return lng - 360;
  if (lng < -180) return lng + 360;
  return lng;
}

export function satelliteShellVectors(
  sat: SatellitePosition,
  relAlt: number
): { start: [number, number, number]; end: [number, number, number] } {
  const start = satPos3(sat.lat, sat.lng, relAlt);
  const end =
    sat.targetLat == null || sat.targetLng == null
      ? start
      : satPos3(sat.targetLat, sat.targetLng, relAlt);

  return { start, end };
}

export function interpolateShellVector(
  start: ArrayLike<number>,
  end: ArrayLike<number>,
  radius: number,
  progress: number
): [number, number, number] {
  let x = start[0] + (end[0] - start[0]) * progress;
  let y = start[1] + (end[1] - start[1]) * progress;
  let z = start[2] + (end[2] - start[2]) * progress;
  const len = Math.sqrt(x * x + y * y + z * z);

  if (len === 0) return [start[0], start[1], start[2]];

  const scale = radius / len;
  x *= scale;
  y *= scale;
  z *= scale;
  return [x, y, z];
}
