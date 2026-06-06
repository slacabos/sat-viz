import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type { GlobeMethods } from 'react-globe.gl';
import * as THREE from 'three';
import { useAppStore } from '../store/useAppStore';
import { classifyOrbit, SAT_REL_ALT } from '../lib/altitudeScale';
import { COLORS } from '../lib/colorConfig';
import { recordPerf, timePerf } from '../lib/perf';
import {
  clampSampleProgress,
  interpolateShellVector,
  satelliteShellVectors,
  SATELLITE_FRAME_MS,
} from '../lib/satelliteAnimation';
import type { SatellitePosition } from '../types/satellite';

const MAX_SATS = 12000;
const CULL_THROTTLE_MS = 100;
const PICK_BOUND_RADIUS = 120;
// Cull satellites whose normalized direction has a dot product below this threshold
// with the camera direction. -0.1 preserves near-horizon satellites to avoid pop-in.
const CULL_THRESHOLD = -0.1;

export type SatMeshes = [THREE.InstancedMesh, THREE.InstancedMesh, THREE.InstancedMesh];

export interface SatelliteInstances {
  // The ref itself (not the value) so click handlers always read the current meshes,
  // even when the ref is populated after the initial render.
  meshesRef: RefObject<SatMeshes | null>;
  // Per-class data arrays, rebuilt each reCull, indexed by current instance slot.
  // Use these for click resolution (instanceId → SatellitePosition).
  leoData: RefObject<SatellitePosition[]>;
  meoData: RefObject<SatellitePosition[]>;
  geoData: RefObject<SatellitePosition[]>;
}

export function useSatelliteInstances(
  globeRef: RefObject<GlobeMethods | undefined>,
  ready: boolean
): SatelliteInstances {
  // Stable refs returned to the caller for click-detection lookup
  const leoData = useRef<SatellitePosition[]>([]);
  const meoData = useRef<SatellitePosition[]>([]);
  const geoData = useRef<SatellitePosition[]>([]);

  // Internal mutable state — intentionally NOT React state, all managed imperatively
  const meshesRef = useRef<SatMeshes | null>(null);
  const globeGroupRef = useRef<THREE.Group | null>(null);

  // Pre-computed buffers for the culling and animation passes.
  const renderMatrices = useRef<Float32Array>(new Float32Array(MAX_SATS * 16));
  const startPositions = useRef<Float32Array>(new Float32Array(MAX_SATS * 3));
  const endPositions = useRef<Float32Array>(new Float32Array(MAX_SATS * 3));
  const shellRadii = useRef<Float32Array>(new Float32Array(MAX_SATS));
  const sampleTimes = useRef<Float64Array>(new Float64Array(MAX_SATS));
  const targetTimes = useRef<Float64Array>(new Float64Array(MAX_SATS));
  const satDirs = useRef<Float32Array>(new Float32Array(MAX_SATS * 3));
  const satClass = useRef<Uint8Array>(new Uint8Array(MAX_SATS));
  const satDataFlat = useRef<SatellitePosition[]>([]);
  const totalCount = useRef(0);

  useEffect(() => {
    if (!ready || !globeRef.current) return;

    const scene = globeRef.current.scene();
    const globeGroup = scene.children.find((c): c is THREE.Group => c instanceof THREE.Group);
    if (!globeGroup) {
      console.error('[useSatelliteInstances] Could not find ThreeGlobe Group in scene');
      return;
    }
    globeGroupRef.current = globeGroup;
    // Capture in a local const so closures below always have a non-nullable reference
    const group = globeGroup;

    const geo = new THREE.SphereGeometry(0.4, 6, 4);
    const pickGeo = new THREE.SphereGeometry(1.35, 8, 6);
    const makePickMaterial = () => {
      const material = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 });
      material.colorWrite = false;
      return material;
    };
    const meshLEO = new THREE.InstancedMesh(
      geo,
      new THREE.MeshLambertMaterial({ color: COLORS.satellite }),
      MAX_SATS
    );
    const meshMEO = new THREE.InstancedMesh(
      geo,
      new THREE.MeshLambertMaterial({ color: '#818cf8' }),
      MAX_SATS
    );
    const meshGEO = new THREE.InstancedMesh(
      geo,
      new THREE.MeshLambertMaterial({ color: '#fbbf24' }),
      MAX_SATS
    );
    const pickLEO = new THREE.InstancedMesh(pickGeo, makePickMaterial(), MAX_SATS);
    const pickMEO = new THREE.InstancedMesh(pickGeo, makePickMaterial(), MAX_SATS);
    const pickGEO = new THREE.InstancedMesh(pickGeo, makePickMaterial(), MAX_SATS);
    const visualMeshes: SatMeshes = [meshLEO, meshMEO, meshGEO];
    const pickMeshes: SatMeshes = [pickLEO, pickMEO, pickGEO];

    for (const m of [...visualMeshes, ...pickMeshes]) {
      m.count = 0;
      m.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), PICK_BOUND_RADIUS);
      // Disable Three.js frustum culling at the mesh level — the bounding sphere
      // at count=0 is degenerate, and per-instance culling is handled manually.
      m.frustumCulled = false;
    }

    group.add(...visualMeshes, ...pickMeshes);
    meshesRef.current = pickMeshes;

    const camera = globeRef.current.camera();
    const scratchCameraLocal = new THREE.Vector3();
    let satellitesVisible = true;
    let lastCullAt = 0;
    let lastFrameAt = 0;
    let animationFrame: number | null = null;
    let pendingCullTimer: ReturnType<typeof setTimeout> | null = null;
    const visibleSourceIndices = [
      new Int32Array(MAX_SATS),
      new Int32Array(MAX_SATS),
      new Int32Array(MAX_SATS),
    ];
    // OrbitControls extends EventDispatcher; cast to access addEventListener
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const controls = globeRef.current.controls() as any as THREE.EventDispatcher<
      Record<string, THREE.Event>
    >;

    function updateRenderMatrices(nowMs: number) {
      const n = totalCount.current;
      const starts = startPositions.current;
      const ends = endPositions.current;
      const radii = shellRadii.current;
      const fromTimes = sampleTimes.current;
      const toTimes = targetTimes.current;
      const dirs = satDirs.current;
      const mats = renderMatrices.current;

      for (let i = 0; i < n; i++) {
        const pi = i * 3;
        const progress = clampSampleProgress(nowMs, fromTimes[i], toTimes[i]);
        const [x, y, z] = interpolateShellVector(
          starts.subarray(pi, pi + 3),
          ends.subarray(pi, pi + 3),
          radii[i],
          progress
        );

        dirs[pi] = x / radii[i];
        dirs[pi + 1] = y / radii[i];
        dirs[pi + 2] = z / radii[i];

        const mi = i * 16;
        mats[mi + 12] = x;
        mats[mi + 13] = y;
        mats[mi + 14] = z;
      }
    }

    function copyMatrix(
      src: ArrayLike<number>,
      dest: ArrayLike<number>,
      srcOffset: number,
      destOffset: number
    ) {
      const target = dest as number[];
      target[destOffset] = src[srcOffset];
      target[destOffset + 1] = src[srcOffset + 1];
      target[destOffset + 2] = src[srcOffset + 2];
      target[destOffset + 3] = src[srcOffset + 3];
      target[destOffset + 4] = src[srcOffset + 4];
      target[destOffset + 5] = src[srcOffset + 5];
      target[destOffset + 6] = src[srcOffset + 6];
      target[destOffset + 7] = src[srcOffset + 7];
      target[destOffset + 8] = src[srcOffset + 8];
      target[destOffset + 9] = src[srcOffset + 9];
      target[destOffset + 10] = src[srcOffset + 10];
      target[destOffset + 11] = src[srcOffset + 11];
      target[destOffset + 12] = src[srcOffset + 12];
      target[destOffset + 13] = src[srcOffset + 13];
      target[destOffset + 14] = src[srcOffset + 14];
      target[destOffset + 15] = src[srcOffset + 15];
    }

    function paintVisibleInstances() {
      const mats = renderMatrices.current;
      const meshArr = visualMeshes;
      const pickMeshArr = meshesRef.current!;

      for (let cls = 0; cls < 3; cls++) {
        const count = meshArr[cls].count;
        const sources = visibleSourceIndices[cls];
        const instanceMatrix = meshArr[cls].instanceMatrix.array;
        const pickInstanceMatrix = pickMeshArr[cls].instanceMatrix.array;

        for (let dst = 0; dst < count; dst++) {
          const src = sources[dst] * 16;
          const dest = dst * 16;
          copyMatrix(mats, instanceMatrix, src, dest);
          copyMatrix(mats, pickInstanceMatrix, src, dest);
        }

        meshArr[cls].instanceMatrix.needsUpdate = true;
        pickMeshArr[cls].instanceMatrix.needsUpdate = true;
      }
    }

    function animateSatellites(now: number) {
      animationFrame = requestAnimationFrame(animateSatellites);
      if (!satellitesVisible || totalCount.current === 0) return;
      if (now - lastFrameAt < SATELLITE_FRAME_MS) return;

      lastFrameAt = now;
      updateRenderMatrices(Date.now());
      paintVisibleInstances();
    }

    animationFrame = requestAnimationFrame(animateSatellites);

    // ── reCull ──────────────────────────────────────────────────────────────
    // Runs every time the camera moves (OrbitControls fires 'change' each frame
    // during rotation) and after each satellite data update.
    // Filters the global satellite buffer to only the camera-facing hemisphere,
    // copies their pre-computed matrices into the InstancedMesh buffers, and
    // rebuilds the per-class data arrays used for click resolution.
    function runReCull() {
      if (!satellitesVisible) return;

      timePerf('satellites.reCull.ms', () => {
        const meshArr = visualMeshes;
        const pickMeshArr = meshesRef.current!;

        // Camera position in globe-local space (world → local strips globe rotation)
        scratchCameraLocal.copy(camera.position);
        group.worldToLocal(scratchCameraLocal).normalize();
        const cx = scratchCameraLocal.x,
          cy = scratchCameraLocal.y,
          cz = scratchCameraLocal.z;

        const dirs = satDirs.current;
        const mats = renderMatrices.current;
        const classes = satClass.current;
        const n = totalCount.current;

        const counts = [0, 0, 0];
        const culled = [leoData.current, meoData.current, geoData.current];
        // Reset culled arrays without reallocating
        culled[0].length = 0;
        culled[1].length = 0;
        culled[2].length = 0;

        const flatData = satDataFlat.current;

        for (let i = 0; i < n; i++) {
          const di = i * 3;
          const dot = dirs[di] * cx + dirs[di + 1] * cy + dirs[di + 2] * cz;
          if (dot < CULL_THRESHOLD) continue;

          const cls = classes[i];
          const dst = counts[cls]++;
          visibleSourceIndices[cls][dst] = i;
          const src = i * 16;
          const dest = dst * 16;
          const instanceMatrix = meshArr[cls].instanceMatrix.array;
          const pickInstanceMatrix = pickMeshArr[cls].instanceMatrix.array;
          copyMatrix(mats, instanceMatrix, src, dest);
          copyMatrix(mats, pickInstanceMatrix, src, dest);
          culled[cls].push(flatData[i]);
        }

        for (let m = 0; m < 3; m++) {
          meshArr[m].count = counts[m];
          meshArr[m].instanceMatrix.needsUpdate = true;
          pickMeshArr[m].count = counts[m];
          pickMeshArr[m].instanceMatrix.needsUpdate = true;
        }
        recordPerf('satellites.rendered.count', counts[0] + counts[1] + counts[2]);
      });
    }

    function reCullNow() {
      if (pendingCullTimer) {
        clearTimeout(pendingCullTimer);
        pendingCullTimer = null;
      }
      lastCullAt = performance.now();
      runReCull();
    }

    function scheduleReCull() {
      if (!satellitesVisible) return;

      const now = performance.now();
      const elapsed = now - lastCullAt;
      if (elapsed >= CULL_THROTTLE_MS) {
        reCullNow();
        return;
      }

      if (pendingCullTimer) return;
      pendingCullTimer = setTimeout(() => {
        pendingCullTimer = null;
        reCullNow();
      }, CULL_THROTTLE_MS - elapsed);
    }

    controls.addEventListener('change', scheduleReCull);

    // ── updateMatrices ──────────────────────────────────────────────────────
    // Called every 10 seconds when the worker delivers new satellite positions.
    // Builds the animation buffers then immediately triggers a reCull so the
    // scene reflects the new data.
    function updateMatrices(satellites: SatellitePosition[]) {
      const n = Math.min(satellites.length, MAX_SATS);
      totalCount.current = n;
      satDataFlat.current = satellites.slice(0, n);

      const starts = startPositions.current;
      const ends = endPositions.current;
      const radii = shellRadii.current;
      const fromTimes = sampleTimes.current;
      const toTimes = targetTimes.current;
      const mats = renderMatrices.current;
      const classes = satClass.current;
      const now = Date.now();

      for (let i = 0; i < n; i++) {
        const sat = satellites[i];
        const cls = classifyOrbit(sat.altKm);
        const relAlt = SAT_REL_ALT[cls];
        classes[i] = cls === 'LEO' ? 0 : cls === 'MEO' ? 1 : 2;

        const di = i * 3;
        const vectors = satelliteShellVectors(sat, relAlt);
        starts[di] = vectors.start[0];
        starts[di + 1] = vectors.start[1];
        starts[di + 2] = vectors.start[2];
        ends[di] = vectors.end[0];
        ends[di + 1] = vectors.end[1];
        ends[di + 2] = vectors.end[2];
        radii[i] = Math.sqrt(
          vectors.start[0] * vectors.start[0] +
            vectors.start[1] * vectors.start[1] +
            vectors.start[2] * vectors.start[2]
        );
        fromTimes[i] = sat.sampleTimeMs ?? now;
        toTimes[i] = sat.targetTimeMs ?? fromTimes[i];

        // Column-major identity+translation matrix layout expected by Three.js
        const mi = i * 16;
        mats[mi] = 1;
        mats[mi + 1] = 0;
        mats[mi + 2] = 0;
        mats[mi + 3] = 0;
        mats[mi + 4] = 0;
        mats[mi + 5] = 1;
        mats[mi + 6] = 0;
        mats[mi + 7] = 0;
        mats[mi + 8] = 0;
        mats[mi + 9] = 0;
        mats[mi + 10] = 1;
        mats[mi + 11] = 0;
        mats[mi + 12] = vectors.start[0];
        mats[mi + 13] = vectors.start[1];
        mats[mi + 14] = vectors.start[2];
        mats[mi + 15] = 1;
      }

      updateRenderMatrices(now);
      reCullNow();
    }

    // ── Layer visibility ─────────────────────────────────────────────────────
    function syncVisibility() {
      const state = useAppStore.getState();
      satellitesVisible = state.layers.satellites;
      const visible = [
        satellitesVisible && state.satelliteOrbits.LEO,
        satellitesVisible && state.satelliteOrbits.MEO,
        satellitesVisible && state.satelliteOrbits.GEO,
      ];
      for (let i = 0; i < 3; i++) {
        visualMeshes[i].visible = visible[i];
        meshesRef.current![i].visible = visible[i];
      }
      if (satellitesVisible) reCullNow();
    }

    // Imperative Zustand subscriptions — no React re-renders triggered
    const unsub = useAppStore.subscribe((state, prev) => {
      if (state.satellites !== prev.satellites) updateMatrices(state.satellites);
      if (
        state.layers.satellites !== prev.layers.satellites ||
        state.satelliteOrbits !== prev.satelliteOrbits
      ) {
        syncVisibility();
      }
    });

    // Seed with whatever is already in the store (e.g. if globe mounts after first tick)
    const initial = useAppStore.getState();
    if (initial.satellites.length > 0) updateMatrices(initial.satellites);
    syncVisibility();

    return () => {
      unsub();
      controls.removeEventListener('change', scheduleReCull);
      if (animationFrame != null) cancelAnimationFrame(animationFrame);
      if (pendingCullTimer) clearTimeout(pendingCullTimer);
      for (const m of [...visualMeshes, ...pickMeshes]) {
        group.remove(m);
        const mat = m.material;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat.dispose();
      }
      geo.dispose();
      pickGeo.dispose();
      meshesRef.current = null;
      globeGroupRef.current = null;
    };
  }, [ready, globeRef]);

  return { meshesRef, leoData, meoData, geoData };
}
