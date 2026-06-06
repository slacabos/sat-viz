import { useEffect } from 'react';
import type { RefObject } from 'react';
import type { GlobeMethods } from 'react-globe.gl';
import * as THREE from 'three';
import { useAppStore, type SelectedObject } from '../store/useAppStore';
import { altitudeScale, classifyOrbit, satPos3, SAT_REL_ALT } from '../lib/altitudeScale';
import { COLORS } from '../lib/colorConfig';
import {
  clampSampleProgress,
  interpolateShellVector,
  satelliteShellVectors,
  SATELLITE_FRAME_MS,
} from '../lib/satelliteAnimation';

const SURFACE_MARKER_REL_ALT = 0.006;

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
    if (obj.data.lat == null || obj.data.lon == null) return null;
    const altitudeM = obj.data.baroAltitude ?? obj.data.geoAltitude ?? 10_000;
    return satPos3(
      obj.data.lat,
      obj.data.lon,
      Math.max(altitudeScale(altitudeM / 1000), SURFACE_MARKER_REL_ALT)
    );
  }

  return satPos3(obj.data.lat, obj.data.lon, SURFACE_MARKER_REL_ALT);
}

function objectColor(obj: SelectedObject): string {
  if (!obj) return '#ffffff';
  if (obj.type === 'satellite') return COLORS.satellite;
  if (obj.type === 'aircraft') return COLORS.aircraft;
  return COLORS.vessel;
}

function highlightScale(obj: SelectedObject, state: 'selected' | 'hovered'): number {
  if (obj?.type === 'satellite') return state === 'selected' ? 0.9 : 1.2;
  return state === 'selected' ? 0.42 : 0.55;
}

function updateMarker(mesh: THREE.Mesh, obj: SelectedObject, scale: number, nowMs = Date.now()) {
  const pos = objectPosition(obj, nowMs);
  mesh.visible = Boolean(pos);
  if (!pos) return;

  mesh.position.set(pos[0], pos[1], pos[2]);
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

    const selectedGeometry = new THREE.SphereGeometry(1.15, 16, 8);
    const hoverGeometry = new THREE.SphereGeometry(0.9, 12, 6);
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
    let selectedObject: SelectedObject = null;
    let hoveredObject: SelectedObject = null;
    let animationFrame: number | null = null;
    let lastFrameAt = 0;

    selectedMesh.visible = false;
    hoverMesh.visible = false;
    selectedMesh.renderOrder = 10;
    hoverMesh.renderOrder = 9;
    globeGroup.add(selectedMesh, hoverMesh);

    const syncSelected = (obj: SelectedObject) => {
      selectedObject = obj;
      updateMarker(selectedMesh, obj, highlightScale(obj, 'selected'));
    };
    const syncHovered = (obj: SelectedObject) => {
      hoveredObject = obj;
      updateMarker(hoverMesh, obj, highlightScale(obj, 'hovered'));
    };

    const animateMarkers = (now: number) => {
      animationFrame = requestAnimationFrame(animateMarkers);
      if (now - lastFrameAt < SATELLITE_FRAME_MS) return;
      lastFrameAt = now;

      const wallClockNow = Date.now();
      if (selectedObject?.type === 'satellite') {
        updateMarker(
          selectedMesh,
          selectedObject,
          highlightScale(selectedObject, 'selected'),
          wallClockNow
        );
      }
      if (hoveredObject?.type === 'satellite') {
        updateMarker(
          hoverMesh,
          hoveredObject,
          highlightScale(hoveredObject, 'hovered'),
          wallClockNow
        );
      }
    };

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
      if (animationFrame != null) cancelAnimationFrame(animationFrame);
      globeGroup.remove(selectedMesh, hoverMesh);
      selectedGeometry.dispose();
      hoverGeometry.dispose();
      selectedMaterial.dispose();
      hoverMaterial.dispose();
    };
  }, [ready, globeRef]);
}
