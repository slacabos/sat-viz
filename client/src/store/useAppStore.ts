import { create } from 'zustand';
import type { SatellitePosition } from '../types/satellite';
import type { AircraftState } from '../types/aircraft';
import type { VesselPosition } from '../types/vessel';
import { recordPerf, timePerf } from '../lib/perf';
import type { OrbitClass } from '../lib/altitudeScale';

export type SelectedObject =
  | { type: 'satellite'; data: SatellitePosition }
  | { type: 'aircraft'; data: AircraftState }
  | { type: 'vessel'; data: VesselPosition }
  | null;

interface LayerVisibility {
  satellites: boolean;
  aircraft: boolean;
  vessels: boolean;
}

type OrbitVisibility = Record<OrbitClass, boolean>;

interface AppState {
  layers: LayerVisibility;
  toggleLayer: (layer: keyof LayerVisibility) => void;
  satelliteOrbits: OrbitVisibility;
  toggleSatelliteOrbit: (orbit: OrbitClass) => void;

  satellites: SatellitePosition[];
  aircraft: AircraftState[];
  vessels: VesselPosition[];

  setSatellites: (data: SatellitePosition[]) => void;
  setAircraft: (data: AircraftState[]) => void;
  bulkUpsertVessels: (data: VesselPosition[]) => void;
  clearVessels: () => void;

  selectedObject: SelectedObject;
  setSelectedObject: (obj: SelectedObject) => void;
  hoveredObject: SelectedObject;
  setHoveredObject: (obj: SelectedObject) => void;

  lastUpdated: { satellites: number | null; aircraft: number | null; vessels: number | null };
  setLastUpdated: (layer: 'satellites' | 'aircraft' | 'vessels', ts: number) => void;

  wsStatus: 'connecting' | 'connected' | 'disconnected';
  setWsStatus: (s: 'connecting' | 'connected' | 'disconnected') => void;

  autoRotate: boolean;
  setAutoRotate: (v: boolean) => void;
}

export const useAppStore = create<AppState>((set) => {
  let vesselMap = new Map<string, VesselPosition>();

  return {
    layers: { satellites: true, aircraft: true, vessels: true },
    toggleLayer: (layer) => set((s) => ({ layers: { ...s.layers, [layer]: !s.layers[layer] } })),
    satelliteOrbits: { LEO: true, MEO: true, GEO: true },
    toggleSatelliteOrbit: (orbit) =>
      set((s) => ({
        satelliteOrbits: { ...s.satelliteOrbits, [orbit]: !s.satelliteOrbits[orbit] },
      })),

    satellites: [],
    aircraft: [],
    vessels: [],

    setSatellites: (data) => {
      recordPerf('satellites.store.count', data.length);
      set({ satellites: data });
    },
    setAircraft: (data) => {
      recordPerf('aircraft.store.count', data.length);
      set({ aircraft: data });
    },
    bulkUpsertVessels: (data) => {
      timePerf('vessels.store.upsertMs', () => {
        const now = Date.now();
        const tenMinAgo = now - 10 * 60 * 1000;
        data.forEach((v) => vesselMap.set(v.mmsi, v));
        // age out stale vessels
        for (const [mmsi, v] of vesselMap) {
          if (v.lastUpdate < tenMinAgo) vesselMap.delete(mmsi);
        }
        recordPerf('vessels.store.count', vesselMap.size);
        set({ vessels: Array.from(vesselMap.values()) });
      });
    },
    clearVessels: () => {
      vesselMap = new Map();
      set({ vessels: [] });
    },

    selectedObject: null,
    setSelectedObject: (obj) => set({ selectedObject: obj }),
    hoveredObject: null,
    setHoveredObject: (obj) => set({ hoveredObject: obj }),

    lastUpdated: { satellites: null, aircraft: null, vessels: null },
    setLastUpdated: (layer, ts) => set((s) => ({ lastUpdated: { ...s.lastUpdated, [layer]: ts } })),

    wsStatus: 'disconnected',
    setWsStatus: (s) => set({ wsStatus: s }),

    autoRotate: true,
    setAutoRotate: (v) => set({ autoRotate: v }),
  };
});
