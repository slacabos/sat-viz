import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type { GlobeMethods } from 'react-globe.gl';
import * as THREE from 'three';
import { useAppStore } from '../store/useAppStore';
import { classifyOrbit, satPos3, SAT_REL_ALT } from '../lib/altitudeScale';
import { COLORS } from '../lib/colorConfig';
import { recordPerf, timePerf } from '../lib/perf';
import type { SatellitePosition } from '../types/satellite';

const MAX_SATS = 12000;
const CULL_THROTTLE_MS = 100;
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

  // Pre-computed buffers for the culling pass (allocated once on first satellite load)
  const preMatrices = useRef<Float32Array>(new Float32Array(MAX_SATS * 16));
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

    for (const m of [meshLEO, meshMEO, meshGEO]) {
      m.count = 0;
      // Disable Three.js frustum culling at the mesh level — the bounding sphere
      // at count=0 is degenerate, and per-instance culling is handled manually.
      m.frustumCulled = false;
    }

    group.add(meshLEO, meshMEO, meshGEO);
    meshesRef.current = [meshLEO, meshMEO, meshGEO];

    const camera = globeRef.current.camera();
    const scratchCameraLocal = new THREE.Vector3();
    let satellitesVisible = true;
    let lastCullAt = 0;
    let pendingCullTimer: ReturnType<typeof setTimeout> | null = null;
    // OrbitControls extends EventDispatcher; cast to access addEventListener
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const controls = globeRef.current.controls() as any as THREE.EventDispatcher<
      Record<string, THREE.Event>
    >;

    // ── reCull ──────────────────────────────────────────────────────────────
    // Runs every time the camera moves (OrbitControls fires 'change' each frame
    // during rotation) and after each satellite data update.
    // Filters the global satellite buffer to only the camera-facing hemisphere,
    // copies their pre-computed matrices into the InstancedMesh buffers, and
    // rebuilds the per-class data arrays used for click resolution.
    function runReCull() {
      if (!satellitesVisible) return;

      timePerf('satellites.reCull.ms', () => {
        const [mLEO, mMEO, mGEO] = meshesRef.current!;
        const meshArr = [mLEO, mMEO, mGEO];

        // Camera position in globe-local space (world → local strips globe rotation)
        scratchCameraLocal.copy(camera.position);
        group.worldToLocal(scratchCameraLocal).normalize();
        const cx = scratchCameraLocal.x,
          cy = scratchCameraLocal.y,
          cz = scratchCameraLocal.z;

        const dirs = satDirs.current;
        const mats = preMatrices.current;
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
          // Direct typed-array copy: 16 floats from global preMatrices → mesh instanceMatrix
          const src = i * 16;
          const dest = dst * 16;
          const instanceMatrix = meshArr[cls].instanceMatrix.array;
          instanceMatrix[dest] = mats[src];
          instanceMatrix[dest + 1] = mats[src + 1];
          instanceMatrix[dest + 2] = mats[src + 2];
          instanceMatrix[dest + 3] = mats[src + 3];
          instanceMatrix[dest + 4] = mats[src + 4];
          instanceMatrix[dest + 5] = mats[src + 5];
          instanceMatrix[dest + 6] = mats[src + 6];
          instanceMatrix[dest + 7] = mats[src + 7];
          instanceMatrix[dest + 8] = mats[src + 8];
          instanceMatrix[dest + 9] = mats[src + 9];
          instanceMatrix[dest + 10] = mats[src + 10];
          instanceMatrix[dest + 11] = mats[src + 11];
          instanceMatrix[dest + 12] = mats[src + 12];
          instanceMatrix[dest + 13] = mats[src + 13];
          instanceMatrix[dest + 14] = mats[src + 14];
          instanceMatrix[dest + 15] = mats[src + 15];
          culled[cls].push(flatData[i]);
        }

        for (let m = 0; m < 3; m++) {
          meshArr[m].count = counts[m];
          meshArr[m].instanceMatrix.needsUpdate = true;
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
    // Builds the pre-computed buffers (preMatrices, satDirs, satClass) then
    // immediately triggers a reCull so the scene reflects the new data.
    function updateMatrices(satellites: SatellitePosition[]) {
      const n = Math.min(satellites.length, MAX_SATS);
      totalCount.current = n;
      satDataFlat.current = satellites.slice(0, n);

      const dirs = satDirs.current;
      const mats = preMatrices.current;
      const classes = satClass.current;

      for (let i = 0; i < n; i++) {
        const sat = satellites[i];
        const cls = classifyOrbit(sat.altKm);
        const relAlt = SAT_REL_ALT[cls];
        classes[i] = cls === 'LEO' ? 0 : cls === 'MEO' ? 1 : 2;

        const [x, y, z] = satPos3(sat.lat, sat.lng, relAlt);

        // Normalized direction for cull dot-product test
        const r = Math.sqrt(x * x + y * y + z * z);
        const di = i * 3;
        dirs[di] = x / r;
        dirs[di + 1] = y / r;
        dirs[di + 2] = z / r;

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
        mats[mi + 12] = x;
        mats[mi + 13] = y;
        mats[mi + 14] = z;
        mats[mi + 15] = 1;
      }

      reCullNow();
    }

    // ── Layer visibility ─────────────────────────────────────────────────────
    function setVisible(v: boolean) {
      satellitesVisible = v;
      for (const m of meshesRef.current!) m.visible = v;
      if (v) reCullNow();
    }

    // Imperative Zustand subscriptions — no React re-renders triggered
    const unsub = useAppStore.subscribe((state, prev) => {
      if (state.satellites !== prev.satellites) updateMatrices(state.satellites);
      if (state.layers.satellites !== prev.layers.satellites) setVisible(state.layers.satellites);
    });

    // Seed with whatever is already in the store (e.g. if globe mounts after first tick)
    const initial = useAppStore.getState();
    if (initial.satellites.length > 0) updateMatrices(initial.satellites);
    setVisible(initial.layers.satellites);

    return () => {
      unsub();
      controls.removeEventListener('change', scheduleReCull);
      if (pendingCullTimer) clearTimeout(pendingCullTimer);
      for (const m of meshesRef.current!) {
        group.remove(m);
        const mat = m.material;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat.dispose();
      }
      geo.dispose();
      meshesRef.current = null;
      globeGroupRef.current = null;
    };
  }, [ready, globeRef]);

  return { meshesRef, leoData, meoData, geoData };
}
