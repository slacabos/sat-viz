import { useRef, useEffect, useState, memo } from 'react';
import Globe, { GlobeMethods } from 'react-globe.gl';
import * as THREE from 'three';
import { useAppStore } from '../store/useAppStore';
import type { SelectedObject } from '../store/useAppStore';
import { useSatelliteInstances } from '../hooks/useSatelliteInstances';
import { useVesselInstances } from '../hooks/useVesselInstances';
import { useAircraftInstances } from '../hooks/useAircraftInstances';
import { useObjectHighlights } from '../hooks/useObjectHighlights';

function addPickTarget(targets: THREE.Object3D[], mesh: THREE.InstancedMesh | null) {
  if (mesh && mesh.visible && mesh.count > 0) targets.push(mesh);
}

function selectedKey(obj: SelectedObject): string {
  if (!obj) return 'none';
  if (obj.type === 'satellite') return `satellite:${obj.data.id}`;
  if (obj.type === 'aircraft') return `aircraft:${obj.data.icao24}`;
  return `vessel:${obj.data.mmsi}`;
}

const GlobeView = memo(function GlobeView() {
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [globeReady, setGlobeReady] = useState(false);

  const setSelectedObject = useAppStore((s) => s.setSelectedObject);
  const setHoveredObject = useAppStore((s) => s.setHoveredObject);
  const autoRotate = useAppStore((s) => s.autoRotate);
  const setAutoRotate = useAppStore((s) => s.setAutoRotate);

  const { meshesRef, leoData, meoData, geoData } = useSatelliteInstances(globeRef, globeReady);
  const { meshRef: vesselMeshRef, dataRef: vesselData } = useVesselInstances(globeRef, globeReady);
  const { meshRef: aircraftMeshRef, dataRef: aircraftData } = useAircraftInstances(
    globeRef,
    globeReady
  );
  useObjectHighlights(globeRef, globeReady);

  // Resize observer
  useEffect(() => {
    const ro = new ResizeObserver(() => {
      setDims({ w: window.innerWidth, h: window.innerHeight });
    });
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Sync autoRotate store value → OrbitControls
  useEffect(() => {
    const ctrl = globeRef.current?.controls();
    if (!ctrl) return;
    ctrl.autoRotate = autoRotate;
    ctrl.autoRotateSpeed = 0.3;
  }, [autoRotate]);

  // Stop rotation when user starts dragging the globe
  useEffect(() => {
    const ctrl = globeRef.current?.controls();
    if (!ctrl) return;
    const stop = () => setAutoRotate(false);
    ctrl.addEventListener('start', stop);
    return () => ctrl.removeEventListener('start', stop);
  }, [setAutoRotate]);

  // Click detection for custom InstancedMesh layers
  useEffect(() => {
    if (!globeReady || !globeRef.current) return;
    const camera = globeRef.current.camera();
    const domEl = globeRef.current.renderer().domElement;
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let lastHoverKey = 'none';
    let lastHoverAt = 0;
    let downX = 0,
      downY = 0;

    const onDown = (e: PointerEvent) => {
      downX = e.clientX;
      downY = e.clientY;
    };
    const pickObject = (e: PointerEvent): SelectedObject => {
      const rect = domEl.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);

      const meshes = meshesRef.current;
      const hitTargets: THREE.Object3D[] = [];
      if (meshes) {
        meshes.forEach((mesh) => addPickTarget(hitTargets, mesh));
      }
      addPickTarget(hitTargets, aircraftMeshRef.current);
      addPickTarget(hitTargets, vesselMeshRef.current);
      if (hitTargets.length === 0) return null;

      const hits = raycaster.intersectObjects(hitTargets);
      if (!hits.length) return null;
      const { object, instanceId } = hits[0];
      if (instanceId == null) return null;

      if (object === aircraftMeshRef.current) {
        const aircraft = aircraftData.current[instanceId];
        return aircraft ? { type: 'aircraft', data: aircraft } : null;
      }

      if (object === vesselMeshRef.current) {
        const vessel = vesselData.current[instanceId];
        return vessel ? { type: 'vessel', data: vessel } : null;
      }

      if (!meshes) return null;
      const dataRef = object === meshes[0] ? leoData : object === meshes[1] ? meoData : geoData;
      const sat = dataRef.current[instanceId];
      return sat ? { type: 'satellite', data: sat } : null;
    };

    const onMove = (e: PointerEvent) => {
      const now = performance.now();
      if (now - lastHoverAt < 100) return;
      lastHoverAt = now;

      const picked = pickObject(e);
      const key = selectedKey(picked);
      if (key === lastHoverKey) return;

      lastHoverKey = key;
      setHoveredObject(picked);
      domEl.style.cursor = picked ? 'pointer' : '';
    };

    const onLeave = () => {
      lastHoverKey = 'none';
      setHoveredObject(null);
      domEl.style.cursor = '';
    };

    const onUp = (e: PointerEvent) => {
      // Skip if pointer moved more than 4px (it was a drag, not a click)
      if (Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > 4) return;
      const picked = pickObject(e);
      if (!picked) return;
      setAutoRotate(false);
      setSelectedObject(picked);
    };

    domEl.addEventListener('pointerdown', onDown);
    domEl.addEventListener('pointermove', onMove);
    domEl.addEventListener('pointerleave', onLeave);
    domEl.addEventListener('pointerup', onUp);
    return () => {
      domEl.removeEventListener('pointerdown', onDown);
      domEl.removeEventListener('pointermove', onMove);
      domEl.removeEventListener('pointerleave', onLeave);
      domEl.removeEventListener('pointerup', onUp);
      domEl.style.cursor = '';
    };
  }, [
    globeReady,
    meshesRef,
    leoData,
    meoData,
    geoData,
    aircraftMeshRef,
    aircraftData,
    vesselMeshRef,
    vesselData,
    setHoveredObject,
    setAutoRotate,
    setSelectedObject,
  ]);

  return (
    <div ref={containerRef} style={{ width: '100vw', height: '100vh', background: '#000011' }}>
      <Globe
        ref={globeRef}
        width={dims.w}
        height={dims.h}
        globeImageUrl="//unpkg.com/three-globe/example/img/earth-blue-marble.jpg"
        bumpImageUrl="//unpkg.com/three-globe/example/img/earth-topology.png"
        backgroundImageUrl="//unpkg.com/three-globe/example/img/night-sky.png"
        showAtmosphere={true}
        atmosphereColor="#3a7bd5"
        atmosphereAltitude={0.15}
        onGlobeReady={() => setGlobeReady(true)}
      />
    </div>
  );
});

export default GlobeView;
