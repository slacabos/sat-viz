const FAR_CAMERA_DISTANCE = 350;
const NEAR_CAMERA_DISTANCE = 105;
const DEFAULT_FAR_MARKER_PX = 18;
const DEFAULT_NEAR_MARKER_PX = 8;
const MAX_SURFACE_MARKER_SCALE = 1;

interface SurfaceMarkerPixelOptions {
  farPixels?: number;
  nearPixels?: number;
}

interface SurfaceMarkerWorldScaleOptions {
  baseWorldSize: number;
  maxScale?: number;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function smoothstep(value: number): number {
  return value * value * (3 - 2 * value);
}

export function surfaceMarkerTargetPixels(
  cameraDistanceFromGlobeCenter: number,
  options: SurfaceMarkerPixelOptions = {}
): number {
  const farPixels = options.farPixels ?? DEFAULT_FAR_MARKER_PX;
  const nearPixels = options.nearPixels ?? DEFAULT_NEAR_MARKER_PX;
  if (!Number.isFinite(cameraDistanceFromGlobeCenter)) return farPixels;

  const t = clamp01(
    (cameraDistanceFromGlobeCenter - NEAR_CAMERA_DISTANCE) /
      (FAR_CAMERA_DISTANCE - NEAR_CAMERA_DISTANCE)
  );
  return nearPixels + (farPixels - nearPixels) * smoothstep(t);
}

export function surfaceMarkerWorldScale(
  cameraDistanceToMarker: number,
  viewportHeightPx: number,
  cameraFovDeg: number,
  targetPixels: number,
  options: SurfaceMarkerWorldScaleOptions
): number {
  const { baseWorldSize, maxScale = MAX_SURFACE_MARKER_SCALE } = options;
  if (
    !Number.isFinite(cameraDistanceToMarker) ||
    !Number.isFinite(viewportHeightPx) ||
    !Number.isFinite(cameraFovDeg) ||
    !Number.isFinite(targetPixels) ||
    !Number.isFinite(baseWorldSize) ||
    cameraDistanceToMarker <= 0 ||
    viewportHeightPx <= 0 ||
    cameraFovDeg <= 0 ||
    targetPixels <= 0 ||
    baseWorldSize <= 0
  ) {
    return maxScale;
  }

  const visibleWorldHeight = 2 * cameraDistanceToMarker * Math.tan((cameraFovDeg * Math.PI) / 360);
  const worldUnitsPerPixel = visibleWorldHeight / viewportHeightPx;
  const targetWorldSize = targetPixels * worldUnitsPerPixel;

  return Math.max(0, Math.min(maxScale, targetWorldSize / baseWorldSize));
}
