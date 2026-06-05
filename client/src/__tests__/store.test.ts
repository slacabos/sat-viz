import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../store/useAppStore';
import type { VesselPosition } from '../types/vessel';

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

describe('useAppStore — bulkUpsertVessels', () => {
  beforeEach(() => {
    useAppStore.getState().clearVessels();
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
});
