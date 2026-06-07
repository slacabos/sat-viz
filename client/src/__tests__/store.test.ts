import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../store/useAppStore';
import type { AircraftState } from '../types/aircraft';
import type { VesselPosition } from '../types/vessel';

function makeAircraft(icao24: string, overrides: Partial<AircraftState> = {}): AircraftState {
  return {
    icao24,
    callsign: null,
    originCountry: 'United Kingdom',
    lon: -0.1,
    lat: 51.5,
    baroAltitude: 10_000,
    onGround: false,
    velocity: 200,
    trueTrack: 90,
    verticalRate: 0,
    geoAltitude: null,
    ...overrides,
  };
}

function makeVessel(mmsi: string, overrides: Partial<VesselPosition> = {}): VesselPosition {
  return {
    mmsi,
    shipName: `Ship ${mmsi}`,
    lat: 51.5,
    lon: -0.1,
    sog: 10,
    cog: 90,
    heading: 90,
    shipType: 70,
    lastUpdate: Date.now(),
    ...overrides,
  };
}

describe('useAppStore — layer toggles', () => {
  it('toggles a layer off', () => {
    useAppStore.setState({ layers: { satellites: true, aircraft: true, vessels: true } });
    useAppStore.getState().toggleLayer('satellites');
    expect(useAppStore.getState().layers.satellites).toBe(false);
  });

  it('toggles a layer back on', () => {
    useAppStore.setState({ layers: { satellites: false, aircraft: true, vessels: true } });
    useAppStore.getState().toggleLayer('satellites');
    expect(useAppStore.getState().layers.satellites).toBe(true);
  });

  it('toggling one layer does not affect others', () => {
    useAppStore.setState({ layers: { satellites: true, aircraft: true, vessels: true } });
    useAppStore.getState().toggleLayer('aircraft');
    const { layers } = useAppStore.getState();
    expect(layers.satellites).toBe(true);
    expect(layers.vessels).toBe(true);
    expect(layers.aircraft).toBe(false);
  });
});

describe('useAppStore — selected orbit', () => {
  beforeEach(() => {
    useAppStore.setState({
      showSelectedOrbit: true,
      satelliteTlesById: {},
    });
  });

  it('toggles selected orbit visibility', () => {
    useAppStore.getState().toggleSelectedOrbit();
    expect(useAppStore.getState().showSelectedOrbit).toBe(false);
    useAppStore.getState().toggleSelectedOrbit();
    expect(useAppStore.getState().showSelectedOrbit).toBe(true);
  });

  it('stores satellite TLEs by NORAD id', () => {
    useAppStore.getState().setSatelliteTles({
      25544: {
        name: 'ISS',
        line1: '1 25544U 98067A   24156.52996528  .00018401  00000+0  33219-3 0  9993',
        line2: '2 25544  51.6401 215.0481 0004986 310.8137 197.0690 15.49813782456123',
      },
    });

    expect(useAppStore.getState().satelliteTlesById[25544]?.name).toBe('ISS');
  });
});

describe('useAppStore — bulkUpsertVessels', () => {
  beforeEach(() => {
    useAppStore.getState().clearVessels();
    useAppStore.getState().setSelectedObject(null);
    useAppStore.getState().setHoveredObject(null);
  });

  it('adds new vessels', () => {
    useAppStore.getState().bulkUpsertVessels([makeVessel('111'), makeVessel('222')]);
    expect(useAppStore.getState().vessels).toHaveLength(2);
  });

  it('updates existing vessel by MMSI', () => {
    useAppStore.getState().bulkUpsertVessels([makeVessel('111', { sog: 5 })]);
    useAppStore.getState().bulkUpsertVessels([makeVessel('111', { sog: 15 })]);
    const vessels = useAppStore.getState().vessels;
    expect(vessels).toHaveLength(1);
    expect(vessels[0].sog).toBe(15);
  });

  it('ages out vessels older than 10 minutes', () => {
    const tenMinAgo = Date.now() - 11 * 60 * 1000;
    useAppStore.getState().bulkUpsertVessels([makeVessel('old', { lastUpdate: tenMinAgo })]);
    // Trigger another upsert so the age-out logic runs
    useAppStore.getState().bulkUpsertVessels([makeVessel('new')]);
    const vessels = useAppStore.getState().vessels;
    expect(vessels.find((v) => v.mmsi === 'old')).toBeUndefined();
    expect(vessels.find((v) => v.mmsi === 'new')).toBeDefined();
  });

  it('refreshes selected and hovered vessels by MMSI', () => {
    const selected = makeVessel('111', { lat: 1 });
    const hovered = makeVessel('222', { lat: 2 });

    useAppStore.getState().bulkUpsertVessels([selected, hovered]);
    useAppStore.getState().setSelectedObject({ type: 'vessel', data: selected });
    useAppStore.getState().setHoveredObject({ type: 'vessel', data: hovered });
    useAppStore
      .getState()
      .bulkUpsertVessels([makeVessel('111', { lat: 11 }), makeVessel('222', { lat: 22 })]);

    expect(useAppStore.getState().selectedObject).toMatchObject({
      type: 'vessel',
      data: { mmsi: '111', lat: 11 },
    });
    expect(useAppStore.getState().hoveredObject).toMatchObject({
      type: 'vessel',
      data: { mmsi: '222', lat: 22 },
    });
  });
});

describe('useAppStore — setAircraft', () => {
  beforeEach(() => {
    useAppStore.getState().setAircraft([]);
    useAppStore.getState().setSelectedObject(null);
    useAppStore.getState().setHoveredObject(null);
  });

  it('refreshes selected and hovered aircraft by ICAO24', () => {
    const selected = makeAircraft('abc123', { lat: 1 });
    const hovered = makeAircraft('def456', { lat: 2 });

    useAppStore.getState().setAircraft([selected, hovered]);
    useAppStore.getState().setSelectedObject({ type: 'aircraft', data: selected });
    useAppStore.getState().setHoveredObject({ type: 'aircraft', data: hovered });
    useAppStore
      .getState()
      .setAircraft([makeAircraft('abc123', { lat: 11 }), makeAircraft('def456', { lat: 22 })]);

    expect(useAppStore.getState().selectedObject).toMatchObject({
      type: 'aircraft',
      data: { icao24: 'abc123', lat: 11 },
    });
    expect(useAppStore.getState().hoveredObject).toMatchObject({
      type: 'aircraft',
      data: { icao24: 'def456', lat: 22 },
    });
  });
});
