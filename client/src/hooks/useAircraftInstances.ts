import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type { GlobeMethods } from 'react-globe.gl';
import * as THREE from 'three';
import { useAppStore } from '../store/useAppStore';
import { altitudeScale, satPos3 } from '../lib/altitudeScale';
import { COLORS } from '../lib/colorConfig';
import { recordPerf, timePerf } from '../lib/perf';
import type { AircraftState } from '../types/aircraft';

const MAX_AIRCRAFT = 20_000;
const PICK_BOUND_RADIUS = 102;

export interface AircraftInstances {
  meshRef: RefObject<THREE.InstancedMesh | null>;
  dataRef: RefObject<AircraftState[]>;
}

export function useAircraftInstances(
  globeRef: RefObject<GlobeMethods | undefined>,
  ready: boolean
): AircraftInstances {
  const meshRef = useRef<THREE.InstancedMesh | null>(null);
  const dataRef = useRef<AircraftState[]>([]);

  useEffect(() => {
    if (!ready || !globeRef.current) return;

    const scene = globeRef.current.scene();
    const globeGroup = scene.children.find((c): c is THREE.Group => c instanceof THREE.Group);
    if (!globeGroup) {
      console.error('[useAircraftInstances] Could not find ThreeGlobe Group in scene');
      return;
    }

    const geometry = new THREE.ConeGeometry(0.3, 1.0, 4);
    geometry.rotateX(Math.PI / 2);
    const pickGeometry = new THREE.SphereGeometry(1.4, 8, 6);
    const material = new THREE.MeshLambertMaterial({ color: COLORS.aircraft });
    const pickMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 });
    pickMaterial.colorWrite = false;
    const mesh = new THREE.InstancedMesh(geometry, material, MAX_AIRCRAFT);
    const pickMesh = new THREE.InstancedMesh(pickGeometry, pickMaterial, MAX_AIRCRAFT);
    for (const m of [mesh, pickMesh]) {
      m.count = 0;
      m.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), PICK_BOUND_RADIUS);
      m.frustumCulled = false;
    }

    globeGroup.add(mesh, pickMesh);
    meshRef.current = pickMesh;

    function updateAircraft(aircraft: AircraftState[]) {
      timePerf('aircraft.instances.updateMs', () => {
        const instanceMatrix = mesh.instanceMatrix.array;
        const pickInstanceMatrix = pickMesh.instanceMatrix.array;
        dataRef.current.length = 0;

        let count = 0;
        for (const plane of aircraft) {
          if (count >= MAX_AIRCRAFT) break;
          if (plane.lat == null || plane.lon == null || plane.onGround) continue;

          const altitudeM = plane.baroAltitude ?? plane.geoAltitude ?? 10_000;
          const relAlt = altitudeScale(altitudeM / 1000);
          const [x, y, z] = satPos3(plane.lat, plane.lon, relAlt);
          const heading = ((plane.trueTrack ?? 0) * Math.PI) / 180;
          const cos = Math.cos(heading);
          const sin = Math.sin(heading);
          const mi = count * 16;

          instanceMatrix[mi] = cos;
          instanceMatrix[mi + 1] = 0;
          instanceMatrix[mi + 2] = -sin;
          instanceMatrix[mi + 3] = 0;
          instanceMatrix[mi + 4] = 0;
          instanceMatrix[mi + 5] = 1;
          instanceMatrix[mi + 6] = 0;
          instanceMatrix[mi + 7] = 0;
          instanceMatrix[mi + 8] = sin;
          instanceMatrix[mi + 9] = 0;
          instanceMatrix[mi + 10] = cos;
          instanceMatrix[mi + 11] = 0;
          instanceMatrix[mi + 12] = x;
          instanceMatrix[mi + 13] = y;
          instanceMatrix[mi + 14] = z;
          instanceMatrix[mi + 15] = 1;
          pickInstanceMatrix.set(instanceMatrix.subarray(mi, mi + 16), mi);

          dataRef.current.push(plane);
          count += 1;
        }

        for (const m of [mesh, pickMesh]) {
          m.count = count;
          m.instanceMatrix.needsUpdate = true;
        }
        recordPerf('aircraft.instances.count', count);
      });
    }

    function setVisible(visible: boolean) {
      mesh.visible = visible;
      pickMesh.visible = visible;
    }

    const unsub = useAppStore.subscribe((state, prev) => {
      if (state.aircraft !== prev.aircraft) updateAircraft(state.aircraft);
      if (state.layers.aircraft !== prev.layers.aircraft) setVisible(state.layers.aircraft);
    });

    const initial = useAppStore.getState();
    updateAircraft(initial.aircraft);
    setVisible(initial.layers.aircraft);

    return () => {
      unsub();
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
