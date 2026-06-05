import { useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';
import type { AircraftState } from '../types/aircraft';

const POLL_MS = 60_000;

export function useFetchAircraft() {
  const setAircraft = useAppStore((s) => s.setAircraft);
  const setLastUpdated = useAppStore((s) => s.setLastUpdated);

  useEffect(() => {
    async function fetchAircraft() {
      try {
        const resp = await fetch('/api/aircraft');
        if (!resp.ok) return;
        const body: { states: AircraftState[] } = await resp.json();
        setAircraft(body.states ?? []);
        setLastUpdated('aircraft', Date.now());
      } catch {
        // silently keep stale data
      }
    }

    fetchAircraft();
    const timer = setInterval(fetchAircraft, POLL_MS);
    return () => clearInterval(timer);
  }, [setAircraft, setLastUpdated]);
}
