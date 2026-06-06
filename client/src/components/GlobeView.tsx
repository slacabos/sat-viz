import { useRef, useEffect, useState, useMemo, useCallback, memo } from 'react';
import Globe, { GlobeMethods } from 'react-globe.gl';
import * as THREE from 'three';
import { useAppStore } from '../store/useAppStore';
import { altitudeScale } from '../lib/altitudeScale';
import { COLORS } from '../lib/colorConfig';
import { useSatelliteInstances } from '../hooks/useSatelliteInstances';
import type { AircraftState } from '../types/aircraft';
import type { VesselPosition } from '../types/vessel';

// Shared Three.js geometries — created once
const AIRCRAFT_GEO = new THREE.ConeGeometry(0.3, 1.0, 4);
AIRCRAFT_GEO.rotateX(Math.PI / 2);
const AIRCRAFT_MAT = new THREE.MeshLambertMaterial({ color: COLORS.aircraft });

const VESSEL_GEO = new THREE.BoxGeometry(0.5, 0.2, 0.9);
const VESSEL_MAT = new THREE.MeshLambertMaterial({ color: COLORS.vessel });

type CombinedObject =
  | (AircraftState & { _type: 'aircraft' })
  | (VesselPosition & { _type: 'vessel' });

function makeAircraftMesh(): THREE.Mesh {
  return new THREE.Mesh(AIRCRAFT_GEO, AIRCRAFT_MAT);
}

function makeVesselMesh(): THREE.Mesh {
  return new THREE.Mesh(VESSEL_GEO, VESSEL_MAT);
}

const GlobeView = memo(function GlobeView() {
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [globeReady, setGlobeReady] = useState(false);

  const layers = useAppStore((s) => s.layers);
  const aircraft = useAppStore((s) => s.aircraft);
  const vessels = useAppStore((s) => s.vessels);
  const setSelectedObject = useAppStore((s) => s.setSelectedObject);
  const autoRotate = useAppStore((s) => s.autoRotate);
  const setAutoRotate = useAppStore((s) => s.setAutoRotate);

  const { meshesRef, leoData, meoData, geoData } = useSatelliteInstances(globeRef, globeReady);

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

  // Satellite click detection via raycasting against the InstancedMesh layer
  useEffect(() => {
    if (!globeReady || !globeRef.current) return;
    const camera = globeRef.current.camera();
    const domEl = globeRef.current.renderer().domElement;
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let downX = 0,
      downY = 0;

    const onDown = (e: PointerEvent) => {
      downX = e.clientX;
      downY = e.clientY;
    };
    const onUp = (e: PointerEvent) => {
      // Skip if pointer moved more than 4px (it was a drag, not a click)
      if (Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > 4) return;
      const meshes = meshesRef.current;
      if (!meshes) return;
      const rect = domEl.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(meshes);
      if (!hits.length) return;
      const { object, instanceId } = hits[0];
      if (instanceId == null) return;
      const dataRef = object === meshes[0] ? leoData : object === meshes[1] ? meoData : geoData;
      const sat = dataRef.current[instanceId];
      if (!sat) return;
      setAutoRotate(false);
      setSelectedObject({ type: 'satellite', data: sat });
    };

    domEl.addEventListener('pointerdown', onDown);
    domEl.addEventListener('pointerup', onUp);
    return () => {
      domEl.removeEventListener('pointerdown', onDown);
      domEl.removeEventListener('pointerup', onUp);
    };
  }, [globeReady, meshesRef, leoData, meoData, geoData, setAutoRotate, setSelectedObject]);

  const combinedObjects = useMemo<CombinedObject[]>(() => {
    const result: CombinedObject[] = [];
    if (layers.aircraft) {
      aircraft.forEach((a) => {
        if (a.lat != null && a.lon != null && !a.onGround) {
          result.push({ ...a, _type: 'aircraft' });
        }
      });
    }
    if (layers.vessels) {
      vessels.forEach((v) => {
        result.push({ ...v, _type: 'vessel' });
      });
    }
    // Satellites are rendered by InstancedMesh in useSatelliteInstances, not here
    return result;
  }, [layers.aircraft, layers.vessels, aircraft, vessels]);

  const getObjectAlt = useCallback((d: object) => {
    const obj = d as CombinedObject;
    if (obj._type === 'aircraft') {
      const alt = obj.baroAltitude ?? obj.geoAltitude ?? 10000;
      return altitudeScale(alt / 1000);
    }
    return altitudeScale(0.05); // vessels
  }, []);

  const getObjectLat = useCallback((d: object) => {
    const obj = d as CombinedObject;
    if (obj._type === 'aircraft') return obj.lat ?? 0;
    return obj.lat;
  }, []);

  const getObjectLng = useCallback((d: object) => {
    const obj = d as CombinedObject;
    if (obj._type === 'aircraft') return obj.lon ?? 0;
    return obj.lon;
  }, []);

  const getObjectThree = useCallback((d: object) => {
    const obj = d as CombinedObject;
    if (obj._type === 'aircraft') return makeAircraftMesh();
    return makeVesselMesh();
  }, []);

  const handleObjectClick = useCallback(
    (obj: object) => {
      setAutoRotate(false);
      const d = obj as CombinedObject;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { _type, ...data } = d;
      if (d._type === 'aircraft') {
        setSelectedObject({ type: 'aircraft', data: data as AircraftState });
      } else {
        setSelectedObject({ type: 'vessel', data: data as VesselPosition });
      }
    },
    [setSelectedObject, setAutoRotate]
  );

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
        objectsData={combinedObjects}
        objectLat={getObjectLat}
        objectLng={getObjectLng}
        objectAltitude={getObjectAlt}
        objectThreeObject={getObjectThree}
        onObjectClick={handleObjectClick}
      />
    </div>
  );
});

export default GlobeView;
