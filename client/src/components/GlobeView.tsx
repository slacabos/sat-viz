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

  const layers = useAppStore((s) => s.layers);
  const satellites = useAppStore((s) => s.satellites);
  const aircraft = useAppStore((s) => s.aircraft);
  const vessels = useAppStore((s) => s.vessels);
  const setSelectedObject = useAppStore((s) => s.setSelectedObject);

  // Resize observer
  useEffect(() => {
    const ro = new ResizeObserver(() => {
      setDims({ w: window.innerWidth, h: window.innerHeight });
    });
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Auto-rotate
  useEffect(() => {
    if (globeRef.current) {
      globeRef.current.controls().autoRotate = true;
      globeRef.current.controls().autoRotateSpeed = 0.3;
    }
  }, []);

  const visibleSatellites = useMemo(
    () => (layers.satellites ? satellites : []),
    [layers.satellites, satellites]
  );

  // Combine aircraft + vessels into one objectsData array
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
    return result;
  }, [layers.aircraft, layers.vessels, aircraft, vessels]);

  const getObjectAlt = useCallback((d: object) => {
    const obj = d as CombinedObject;
    if (obj._type === 'aircraft') {
      const alt = obj.baroAltitude ?? obj.geoAltitude ?? 10000;
      return altitudeScale(alt / 1000);
    }
    return altitudeScale(0.05); // vessels at sea level + tiny offset
  }, []);

  const getObjectLat = useCallback((d: object) => {
    const obj = d as CombinedObject;
    return obj._type === 'aircraft' ? (obj.lat ?? 0) : obj.lat;
  }, []);

  const getObjectLng = useCallback((d: object) => {
    const obj = d as CombinedObject;
    return obj._type === 'aircraft' ? (obj.lon ?? 0) : obj.lon;
  }, []);

  const getObjectThree = useCallback((d: object) => {
    const obj = d as CombinedObject;
    return obj._type === 'aircraft' ? makeAircraftMesh() : makeVesselMesh();
  }, []);

  const handleObjectClick = useCallback(
    (obj: object) => {
      const d = obj as CombinedObject;
      if (d._type === 'aircraft') {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { _type, ...data } = d;
        setSelectedObject({ type: 'aircraft', data: data as AircraftState });
      } else {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { _type, ...data } = d;
        setSelectedObject({ type: 'vessel', data: data as VesselPosition });
      }
    },
    [setSelectedObject]
  );

  const handlePointClick = useCallback(
    (point: object) => {
      setSelectedObject({ type: 'satellite', data: point as SatellitePosition });
    },
    [setSelectedObject]
  );

  const getSatColor = useCallback((d: object) => {
    const sat = d as SatellitePosition;
    // LEO <2000km cyan, MEO <35000km blue, GEO+ gold
    if (sat.altKm < 2000) return COLORS.satellite;
    if (sat.altKm < 35000) return '#818cf8'; // indigo
    return '#fbbf24'; // amber/gold for GEO
  }, []);

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
        // Satellite points layer
        pointsData={visibleSatellites}
        pointLat="lat"
        pointLng="lng"
        pointAltitude={(d) => altitudeScale((d as SatellitePosition).altKm)}
        pointColor={getSatColor}
        pointRadius={0.25}
        pointResolution={4}
        pointsMerge={true}
        pointsTransitionDuration={0}
        onPointClick={handlePointClick}
        // Aircraft + vessel objects layer
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
