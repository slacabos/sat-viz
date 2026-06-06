import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type { GlobeMethods } from 'react-globe.gl';
import * as THREE from 'three';
import { useAppStore } from '../store/useAppStore';
import { altitudeScale, satPos3 } from '../lib/altitudeScale';
import { COLORS } from '../lib/colorConfig';
import { recordPerf, timePerf } from '../lib/perf';
import type { VesselPosition } from '../types/vessel';

const MAX_VESSELS = 50_000;
const VESSEL_REL_ALT = altitudeScale(0.05);
const PICK_BOUND_RADIUS = 102;

export interface VesselInstances {
  meshRef: RefObject<THREE.InstancedMesh | null>;
  dataRef: RefObject<VesselPosition[]>;
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

    const geometry = new THREE.BoxGeometry(0.5, 0.2, 0.9);
    const pickGeometry = new THREE.SphereGeometry(1.4, 8, 6);
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

    function updateVessels(vessels: VesselPosition[]) {
      timePerf('vessels.instances.updateMs', () => {
        const count = Math.min(vessels.length, MAX_VESSELS);
        const instanceMatrix = mesh.instanceMatrix.array;
        const pickInstanceMatrix = pickMesh.instanceMatrix.array;
        dataRef.current.length = 0;

        for (let i = 0; i < count; i++) {
          const vessel = vessels[i];
          const [x, y, z] = satPos3(vessel.lat, vessel.lon, VESSEL_REL_ALT);
          const mi = i * 16;

          instanceMatrix[mi] = 1;
          instanceMatrix[mi + 1] = 0;
          instanceMatrix[mi + 2] = 0;
          instanceMatrix[mi + 3] = 0;
          instanceMatrix[mi + 4] = 0;
          instanceMatrix[mi + 5] = 1;
          instanceMatrix[mi + 6] = 0;
          instanceMatrix[mi + 7] = 0;
          instanceMatrix[mi + 8] = 0;
          instanceMatrix[mi + 9] = 0;
          instanceMatrix[mi + 10] = 1;
          instanceMatrix[mi + 11] = 0;
          instanceMatrix[mi + 12] = x;
          instanceMatrix[mi + 13] = y;
          instanceMatrix[mi + 14] = z;
          instanceMatrix[mi + 15] = 1;
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

    const unsub = useAppStore.subscribe((state, prev) => {
      if (state.vessels !== prev.vessels) updateVessels(state.vessels);
      if (state.layers.vessels !== prev.layers.vessels) setVisible(state.layers.vessels);
    });

    const initial = useAppStore.getState();
    updateVessels(initial.vessels);
    setVisible(initial.layers.vessels);

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
