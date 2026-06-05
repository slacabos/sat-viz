import { useRef, useEffect, useState, useMemo, useCallback, memo } from 'react';
import Globe, { GlobeMethods } from 'react-globe.gl';
import * as THREE from 'three';
import { useAppStore } from '../store/useAppStore';
import { altitudeScale } from '../lib/altitudeScale';
import { COLORS } from '../lib/colorConfig';
import type { AircraftState } from '../types/aircraft';
import type { VesselPosition } from '../types/vessel';
import type { SatellitePosition } from '../types/satellite';

// Shared Three.js geometries — created once
const AIRCRAFT_GEO = new THREE.ConeGeometry(0.3, 1.0, 4);
AIRCRAFT_GEO.rotateX(Math.PI / 2);
const AIRCRAFT_MAT = new THREE.MeshLambertMaterial({ color: COLORS.aircraft });

const VESSEL_GEO = new THREE.BoxGeometry(0.5, 0.2, 0.9);
const VESSEL_MAT = new THREE.MeshLambertMaterial({ color: COLORS.vessel });

const SAT_GEO = new THREE.SphereGeometry(0.4, 6, 4);
const SAT_MAT_LEO = new THREE.MeshLambertMaterial({ color: COLORS.satellite }); // cyan
const SAT_MAT_MEO = new THREE.MeshLambertMaterial({ color: '#818cf8' }); // indigo
const SAT_MAT_GEO = new THREE.MeshLambertMaterial({ color: '#fbbf24' }); // gold

type CombinedObject =
  | (AircraftState & { _type: 'aircraft' })
  | (VesselPosition & { _type: 'vessel' })
  | (SatellitePosition & { _type: 'satellite' });

function makeAircraftMesh(): THREE.Mesh {
  return new THREE.Mesh(AIRCRAFT_GEO, AIRCRAFT_MAT);
}

function makeVesselMesh(): THREE.Mesh {
  return new THREE.Mesh(VESSEL_GEO, VESSEL_MAT);
}

function makeSatelliteMesh(altKm: number): THREE.Mesh {
  const mat = altKm >= 35000 ? SAT_MAT_GEO : altKm >= 2000 ? SAT_MAT_MEO : SAT_MAT_LEO;
  return new THREE.Mesh(SAT_GEO, mat);
}

const GlobeView = memo(function GlobeView() {
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: window.innerWidth, h: window.innerHeight });

  const layers = useAppStore((s) => s.layers);
  const satellites = useAppStore((s) => s.satellites);
  const aircraft = useAppStore((s) => s.aircraft);
  const vessels = useAppStore((s) => s.vessels);
  const setSelectedObject = useAppStore((s) => s.setSelectedObject);
  const autoRotate = useAppStore((s) => s.autoRotate);
  const setAutoRotate = useAppStore((s) => s.setAutoRotate);

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
    if (layers.satellites) {
      satellites.forEach((s) => {
        result.push({ ...s, _type: 'satellite' });
      });
    }
    return result;
  }, [layers.aircraft, layers.vessels, layers.satellites, aircraft, vessels, satellites]);

  const getObjectAlt = useCallback((d: object) => {
    const obj = d as CombinedObject;
    if (obj._type === 'aircraft') {
      const alt = obj.baroAltitude ?? obj.geoAltitude ?? 10000;
      return altitudeScale(alt / 1000);
    }
    if (obj._type === 'satellite') {
      if (obj.altKm >= 35000) return 0.14; // GEO shell
      if (obj.altKm >= 2000) return 0.06; // MEO shell
      return 0.02; // LEO shell
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
    if (obj._type === 'satellite') return obj.lng;
    return obj.lon;
  }, []);

  const getObjectThree = useCallback((d: object) => {
    const obj = d as CombinedObject;
    if (obj._type === 'aircraft') return makeAircraftMesh();
    if (obj._type === 'satellite') return makeSatelliteMesh(obj.altKm);
    return makeVesselMesh();
  }, []);

  const handleObjectClick = useCallback(
    (obj: object) => {
      setAutoRotate(false);
      const d = obj as CombinedObject;
      if (d._type === 'aircraft') {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { _type, ...data } = d;
        setSelectedObject({ type: 'aircraft', data: data as AircraftState });
      } else if (d._type === 'satellite') {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { _type, ...data } = d;
        setSelectedObject({ type: 'satellite', data: data as SatellitePosition });
      } else {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { _type, ...data } = d;
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
