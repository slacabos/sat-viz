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
const DEG2RAD = Math.PI / 180;
const MIN_AIRCRAFT_REL_ALT = 0.008;

export interface AircraftInstances {
  meshRef: RefObject<THREE.InstancedMesh | null>;
  dataRef: RefObject<AircraftState[]>;
}

function writeAircraftMatrix(
  target: ArrayLike<number>,
  offset: number,
  lat: number,
  lng: number,
  relAlt: number,
  headingDeg: number
) {
  const [x, y, z] = satPos3(lat, lng, relAlt);
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
  const out = target as number[];

  out[offset] = right.x;
  out[offset + 1] = right.y;
  out[offset + 2] = right.z;
  out[offset + 3] = 0;
  out[offset + 4] = up.x;
  out[offset + 5] = up.y;
  out[offset + 6] = up.z;
  out[offset + 7] = 0;
  out[offset + 8] = forward.x;
  out[offset + 9] = forward.y;
  out[offset + 10] = forward.z;
  out[offset + 11] = 0;
  out[offset + 12] = x;
  out[offset + 13] = y;
  out[offset + 14] = z;
  out[offset + 15] = 1;
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

    const markerShape = new THREE.Shape();
    markerShape.moveTo(0, 0.32);
    markerShape.lineTo(-0.16, -0.18);
    markerShape.lineTo(0.16, -0.18);
    markerShape.closePath();
    const geometry = new THREE.ExtrudeGeometry(markerShape, {
      depth: 0.04,
      bevelEnabled: false,
    });
    geometry.translate(0, 0, -0.02);
    geometry.rotateX(Math.PI / 2);
    const pickGeometry = new THREE.SphereGeometry(0.7, 8, 6);
    const material = new THREE.MeshLambertMaterial({
      color: COLORS.aircraft,
      side: THREE.DoubleSide,
    });
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
          const relAlt = Math.max(altitudeScale(altitudeM / 1000), MIN_AIRCRAFT_REL_ALT);
          const mi = count * 16;
          writeAircraftMatrix(
            instanceMatrix,
            mi,
            plane.lat,
            plane.lon,
            relAlt,
            plane.trueTrack ?? 0
          );
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
