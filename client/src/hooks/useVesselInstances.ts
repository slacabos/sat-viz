import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type { GlobeMethods } from 'react-globe.gl';
import * as THREE from 'three';
import { useAppStore } from '../store/useAppStore';
import { COLORS } from '../lib/colorConfig';
import { recordPerf, timePerf } from '../lib/perf';
import { type SurfacePosition, vesselSurfacePosition } from '../lib/surfaceObjectPosition';
import { surfaceMarkerTargetPixels, surfaceMarkerWorldScale } from '../lib/surfaceMarkerScale';
import type { VesselPosition } from '../types/vessel';

const MAX_VESSELS = 50_000;
const VESSEL_BASE_WORLD_SIZE = 0.45;
const VESSEL_FAR_MARKER_PX = 18;
const VESSEL_NEAR_MARKER_PX = 5;
const PICK_BOUND_RADIUS = 102;
const DEG2RAD = Math.PI / 180;

export interface VesselInstances {
  meshRef: RefObject<THREE.InstancedMesh | null>;
  dataRef: RefObject<VesselPosition[]>;
}

interface MarkerProjection {
  cameraX: number;
  cameraY: number;
  cameraZ: number;
  viewportHeightPx: number;
  fovDeg: number;
  targetPixels: number;
}

function projectedMarkerScale(x: number, y: number, z: number, projection: MarkerProjection) {
  const dx = projection.cameraX - x;
  const dy = projection.cameraY - y;
  const dz = projection.cameraZ - z;
  const cameraDistanceToMarker = Math.sqrt(dx * dx + dy * dy + dz * dz);

  return surfaceMarkerWorldScale(
    cameraDistanceToMarker,
    projection.viewportHeightPx,
    projection.fovDeg,
    projection.targetPixels,
    { baseWorldSize: VESSEL_BASE_WORLD_SIZE }
  );
}

function writeVesselMatrix(
  target: ArrayLike<number>,
  offset: number,
  position: SurfacePosition,
  lat: number,
  lng: number,
  headingDeg: number,
  projection: MarkerProjection
) {
  const { x, y, z } = position;
  const latRad = lat * DEG2RAD;
  const theta = (90 - lng) * DEG2RAD;
  const heading = headingDeg * DEG2RAD;

  const up = new THREE.Vector3(x, y, z).normalize();
  const east = new THREE.Vector3(Math.sin(theta), 0, -Math.cos(theta)).normalize();
  const north = new THREE.Vector3(
    -Math.sin(latRad) * Math.cos(theta),
    Math.cos(latRad),
    -Math.sin(latRad) * Math.sin(theta)
  ).normalize();
  const forward = north
    .multiplyScalar(Math.cos(heading))
    .add(east.multiplyScalar(Math.sin(heading)))
    .normalize();
  const right = new THREE.Vector3().crossVectors(up, forward).normalize();
  const markerScale = projectedMarkerScale(x, y, z, projection);
  const out = target as number[];

  out[offset] = right.x * markerScale;
  out[offset + 1] = right.y * markerScale;
  out[offset + 2] = right.z * markerScale;
  out[offset + 3] = 0;
  out[offset + 4] = up.x * markerScale;
  out[offset + 5] = up.y * markerScale;
  out[offset + 6] = up.z * markerScale;
  out[offset + 7] = 0;
  out[offset + 8] = forward.x * markerScale;
  out[offset + 9] = forward.y * markerScale;
  out[offset + 10] = forward.z * markerScale;
  out[offset + 11] = 0;
  out[offset + 12] = x;
  out[offset + 13] = y;
  out[offset + 14] = z;
  out[offset + 15] = 1;
}

export function useVesselInstances(
  globeRef: RefObject<GlobeMethods | undefined>,
  ready: boolean
): VesselInstances {
  const meshRef = useRef<THREE.InstancedMesh | null>(null);
  const dataRef = useRef<VesselPosition[]>([]);

  useEffect(() => {
    if (!ready || !globeRef.current) return;

    const scene = globeRef.current.scene();
    const globeGroup = scene.children.find((c): c is THREE.Group => c instanceof THREE.Group);
    if (!globeGroup) {
      console.error('[useVesselInstances] Could not find ThreeGlobe Group in scene');
      return;
    }
    const group = globeGroup;

    const geometry = new THREE.BoxGeometry(0.25, 0.1, 0.45);
    const pickGeometry = new THREE.SphereGeometry(0.7, 8, 6);
    const material = new THREE.MeshLambertMaterial({ color: COLORS.vessel });
    const pickMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 });
    pickMaterial.colorWrite = false;
    const mesh = new THREE.InstancedMesh(geometry, material, MAX_VESSELS);
    const pickMesh = new THREE.InstancedMesh(pickGeometry, pickMaterial, MAX_VESSELS);
    for (const m of [mesh, pickMesh]) {
      m.count = 0;
      m.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), PICK_BOUND_RADIUS);
      m.frustumCulled = false;
    }

    globeGroup.add(mesh, pickMesh);
    meshRef.current = pickMesh;

    const camera = globeRef.current.camera();
    const renderer = globeRef.current.renderer();
    const controls = globeRef.current.controls() as unknown as THREE.EventDispatcher<
      Record<string, THREE.Event>
    >;
    const rendererSize = new THREE.Vector2();
    const cameraLocal = new THREE.Vector3();
    let markerScaleFrame: number | null = null;

    function readMarkerProjection(): MarkerProjection {
      cameraLocal.copy(camera.position);
      group.worldToLocal(cameraLocal);
      renderer.getSize(rendererSize);

      return {
        cameraX: cameraLocal.x,
        cameraY: cameraLocal.y,
        cameraZ: cameraLocal.z,
        viewportHeightPx: Math.max(1, rendererSize.y),
        fovDeg: camera instanceof THREE.PerspectiveCamera ? camera.fov : 50,
        targetPixels: surfaceMarkerTargetPixels(cameraLocal.length(), {
          farPixels: VESSEL_FAR_MARKER_PX,
          nearPixels: VESSEL_NEAR_MARKER_PX,
        }),
      };
    }

    function rewriteVesselMatrices(projection: MarkerProjection) {
      const instanceMatrix = mesh.instanceMatrix.array;
      const pickInstanceMatrix = pickMesh.instanceMatrix.array;

      for (let i = 0; i < dataRef.current.length; i++) {
        const vessel = dataRef.current[i];
        const position = vesselSurfacePosition(vessel);
        const mi = i * 16;
        writeVesselMatrix(
          instanceMatrix,
          mi,
          position,
          vessel.lat,
          vessel.lon,
          vessel.heading ?? vessel.cog ?? 0,
          projection
        );
        pickInstanceMatrix.set(instanceMatrix.subarray(mi, mi + 16), mi);
      }

      for (const m of [mesh, pickMesh]) {
        m.instanceMatrix.needsUpdate = true;
      }
    }

    function syncMarkerScale() {
      rewriteVesselMatrices(readMarkerProjection());
    }

    function scheduleMarkerScaleSync() {
      if (markerScaleFrame != null) return;
      markerScaleFrame = requestAnimationFrame(() => {
        markerScaleFrame = null;
        syncMarkerScale();
      });
    }

    function updateVessels(vessels: VesselPosition[]) {
      timePerf('vessels.instances.updateMs', () => {
        const count = Math.min(vessels.length, MAX_VESSELS);
        const instanceMatrix = mesh.instanceMatrix.array;
        const pickInstanceMatrix = pickMesh.instanceMatrix.array;
        dataRef.current.length = 0;
        const projection = readMarkerProjection();

        for (let i = 0; i < count; i++) {
          const vessel = vessels[i];
          const position = vesselSurfacePosition(vessel);
          const mi = i * 16;
          writeVesselMatrix(
            instanceMatrix,
            mi,
            position,
            vessel.lat,
            vessel.lon,
            vessel.heading ?? vessel.cog ?? 0,
            projection
          );
          pickInstanceMatrix.set(instanceMatrix.subarray(mi, mi + 16), mi);

          dataRef.current.push(vessel);
        }

        for (const m of [mesh, pickMesh]) {
          m.count = count;
          m.instanceMatrix.needsUpdate = true;
        }
        recordPerf('vessels.instances.count', count);
      });
    }

    function setVisible(visible: boolean) {
      mesh.visible = visible;
      pickMesh.visible = visible;
    }

    controls.addEventListener('change', scheduleMarkerScaleSync);

    const unsub = useAppStore.subscribe((state, prev) => {
      if (state.vessels !== prev.vessels) updateVessels(state.vessels);
      if (state.layers.vessels !== prev.layers.vessels) setVisible(state.layers.vessels);
    });

    const initial = useAppStore.getState();
    updateVessels(initial.vessels);
    setVisible(initial.layers.vessels);

    return () => {
      unsub();
      controls.removeEventListener('change', scheduleMarkerScaleSync);
      if (markerScaleFrame != null) cancelAnimationFrame(markerScaleFrame);
      globeGroup.remove(mesh, pickMesh);
      geometry.dispose();
      pickGeometry.dispose();
      material.dispose();
      pickMaterial.dispose();
      meshRef.current = null;
      dataRef.current = [];
    };
  }, [ready, globeRef]);

  return { meshRef, dataRef };
}
