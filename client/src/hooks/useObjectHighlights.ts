import { useEffect } from 'react';
import type { RefObject } from 'react';
import type { GlobeMethods } from 'react-globe.gl';
import * as THREE from 'three';
import { useAppStore, type SelectedObject } from '../store/useAppStore';
import { classifyOrbit, SAT_REL_ALT } from '../lib/altitudeScale';
import { COLORS } from '../lib/colorConfig';
import {
  clampSampleProgress,
  interpolateShellVector,
  satelliteShellVectors,
  SATELLITE_FRAME_MS,
} from '../lib/satelliteAnimation';
import { aircraftSurfacePosition, vesselSurfacePosition } from '../lib/surfaceObjectPosition';
import { surfaceMarkerTargetPixels, surfaceMarkerWorldScale } from '../lib/surfaceMarkerScale';

const SURFACE_SELECTED_FAR_PX = 26;
const SURFACE_SELECTED_NEAR_PX = 10;
const SURFACE_HOVER_FAR_PX = 30;
const SURFACE_HOVER_NEAR_PX = 12;
const SELECTED_HIGHLIGHT_RADIUS = 1.15;
const HOVER_HIGHLIGHT_RADIUS = 0.9;
const SURFACE_HIGHLIGHT_MAX_SCALE = 6;

function objectPosition(obj: SelectedObject, nowMs = Date.now()): [number, number, number] | null {
  if (!obj) return null;

  if (obj.type === 'satellite') {
    const orbit = classifyOrbit(obj.data.altKm);
    const vectors = satelliteShellVectors(obj.data, SAT_REL_ALT[orbit]);
    const radius = Math.sqrt(
      vectors.start[0] * vectors.start[0] +
        vectors.start[1] * vectors.start[1] +
        vectors.start[2] * vectors.start[2]
    );
    const progress = clampSampleProgress(nowMs, obj.data.sampleTimeMs, obj.data.targetTimeMs);
    return interpolateShellVector(vectors.start, vectors.end, radius, progress);
  }

  if (obj.type === 'aircraft') {
    const position = aircraftSurfacePosition(obj.data);
    return position ? [position.x, position.y, position.z] : null;
  }

  const position = vesselSurfacePosition(obj.data);
  return [position.x, position.y, position.z];
}

function objectColor(obj: SelectedObject): string {
  if (!obj) return '#ffffff';
  if (obj.type === 'satellite') return COLORS.satellite;
  if (obj.type === 'aircraft') return COLORS.aircraft;
  return COLORS.vessel;
}

function highlightScale(obj: SelectedObject, state: 'selected' | 'hovered'): number {
  if (obj?.type === 'satellite') return state === 'selected' ? 0.45 : 0.6;
  return state === 'selected' ? 0.1 : 0.2;
}

interface HighlightProjection {
  cameraX: number;
  cameraY: number;
  cameraZ: number;
  viewportHeightPx: number;
  fovDeg: number;
  cameraDistanceFromGlobeCenter: number;
}

function projectedSurfaceHighlightScale(
  pos: [number, number, number],
  state: 'selected' | 'hovered',
  projection: HighlightProjection
) {
  const dx = projection.cameraX - pos[0];
  const dy = projection.cameraY - pos[1];
  const dz = projection.cameraZ - pos[2];
  const cameraDistanceToMarker = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const radius = state === 'selected' ? SELECTED_HIGHLIGHT_RADIUS : HOVER_HIGHLIGHT_RADIUS;
  const targetPixels = surfaceMarkerTargetPixels(projection.cameraDistanceFromGlobeCenter, {
    farPixels: state === 'selected' ? SURFACE_SELECTED_FAR_PX : SURFACE_HOVER_FAR_PX,
    nearPixels: state === 'selected' ? SURFACE_SELECTED_NEAR_PX : SURFACE_HOVER_NEAR_PX,
  });

  return surfaceMarkerWorldScale(
    cameraDistanceToMarker,
    projection.viewportHeightPx,
    projection.fovDeg,
    targetPixels,
    {
      baseWorldSize: radius * 2,
      maxScale: SURFACE_HIGHLIGHT_MAX_SCALE,
    }
  );
}

function updateMarker(
  mesh: THREE.Mesh,
  obj: SelectedObject,
  state: 'selected' | 'hovered',
  projection: HighlightProjection | null,
  nowMs = Date.now()
) {
  const pos = objectPosition(obj, nowMs);
  mesh.visible = Boolean(pos);
  if (!pos) return;

  mesh.position.set(pos[0], pos[1], pos[2]);
  const scale =
    obj?.type === 'satellite' || !projection
      ? highlightScale(obj, state)
      : projectedSurfaceHighlightScale(pos, state, projection);
  mesh.scale.setScalar(scale);

  const material = mesh.material;
  if (material instanceof THREE.MeshBasicMaterial) {
    material.color.set(objectColor(obj));
  }
}

export function useObjectHighlights(globeRef: RefObject<GlobeMethods | undefined>, ready: boolean) {
  useEffect(() => {
    if (!ready || !globeRef.current) return;

    const scene = globeRef.current.scene();
    const globeGroup = scene.children.find((c): c is THREE.Group => c instanceof THREE.Group);
    if (!globeGroup) {
      console.error('[useObjectHighlights] Could not find ThreeGlobe Group in scene');
      return;
    }
    const group = globeGroup;

    const selectedGeometry = new THREE.SphereGeometry(SELECTED_HIGHLIGHT_RADIUS, 16, 8);
    const hoverGeometry = new THREE.SphereGeometry(HOVER_HIGHLIGHT_RADIUS, 12, 6);
    const selectedMaterial = new THREE.MeshBasicMaterial({
      color: '#ffffff',
      transparent: true,
      opacity: 0.34,
      wireframe: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const hoverMaterial = new THREE.MeshBasicMaterial({
      color: '#ffffff',
      transparent: true,
      opacity: 0.42,
      wireframe: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const selectedMesh = new THREE.Mesh(selectedGeometry, selectedMaterial);
    const hoverMesh = new THREE.Mesh(hoverGeometry, hoverMaterial);
    const camera = globeRef.current.camera();
    const renderer = globeRef.current.renderer();
    const controls = globeRef.current.controls() as unknown as THREE.EventDispatcher<
      Record<string, THREE.Event>
    >;
    const rendererSize = new THREE.Vector2();
    const cameraLocal = new THREE.Vector3();
    let selectedObject: SelectedObject = null;
    let hoveredObject: SelectedObject = null;
    let animationFrame: number | null = null;
    let controlFrame: number | null = null;
    let lastFrameAt = 0;

    selectedMesh.visible = false;
    hoverMesh.visible = false;
    selectedMesh.renderOrder = 10;
    hoverMesh.renderOrder = 9;
    globeGroup.add(selectedMesh, hoverMesh);

    const readProjection = (): HighlightProjection => {
      cameraLocal.copy(camera.position);
      group.worldToLocal(cameraLocal);
      renderer.getSize(rendererSize);

      return {
        cameraX: cameraLocal.x,
        cameraY: cameraLocal.y,
        cameraZ: cameraLocal.z,
        viewportHeightPx: Math.max(1, rendererSize.y),
        fovDeg: camera instanceof THREE.PerspectiveCamera ? camera.fov : 50,
        cameraDistanceFromGlobeCenter: cameraLocal.length(),
      };
    };

    const syncSelected = (obj: SelectedObject) => {
      selectedObject = obj;
      updateMarker(selectedMesh, obj, 'selected', readProjection());
    };
    const syncHovered = (obj: SelectedObject) => {
      hoveredObject = obj;
      updateMarker(hoverMesh, obj, 'hovered', readProjection());
    };
    const syncHighlights = (nowMs = Date.now()) => {
      const projection = readProjection();
      updateMarker(selectedMesh, selectedObject, 'selected', projection, nowMs);
      updateMarker(hoverMesh, hoveredObject, 'hovered', projection, nowMs);
    };
    const scheduleHighlightSync = () => {
      if (controlFrame != null) return;
      controlFrame = requestAnimationFrame(() => {
        controlFrame = null;
        syncHighlights();
      });
    };

    const animateMarkers = (now: number) => {
      animationFrame = requestAnimationFrame(animateMarkers);
      if (now - lastFrameAt < SATELLITE_FRAME_MS) return;
      lastFrameAt = now;

      const wallClockNow = Date.now();
      if (selectedObject?.type === 'satellite') {
        updateMarker(selectedMesh, selectedObject, 'selected', readProjection(), wallClockNow);
      }
      if (hoveredObject?.type === 'satellite') {
        updateMarker(hoverMesh, hoveredObject, 'hovered', readProjection(), wallClockNow);
      }
    };

    controls.addEventListener('change', scheduleHighlightSync);

    const unsub = useAppStore.subscribe((state, prev) => {
      if (state.selectedObject !== prev.selectedObject) syncSelected(state.selectedObject);
      if (state.hoveredObject !== prev.hoveredObject) syncHovered(state.hoveredObject);
    });

    const initial = useAppStore.getState();
    syncSelected(initial.selectedObject);
    syncHovered(initial.hoveredObject);
    animationFrame = requestAnimationFrame(animateMarkers);

    return () => {
      unsub();
      controls.removeEventListener('change', scheduleHighlightSync);
      if (animationFrame != null) cancelAnimationFrame(animationFrame);
      if (controlFrame != null) cancelAnimationFrame(controlFrame);
      globeGroup.remove(selectedMesh, hoverMesh);
      selectedGeometry.dispose();
      hoverGeometry.dispose();
      selectedMaterial.dispose();
      hoverMaterial.dispose();
    };
  }, [ready, globeRef]);
}
