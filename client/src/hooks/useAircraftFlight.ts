import { useEffect, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';
import type { FlightInfo } from '../types/aircraft';

export function useAircraftFlight(icao24: string | null) {
  const setSelectedFlightInfo = useAppStore((s) => s.setSelectedFlightInfo);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    abortRef.current?.abort();

    if (!icao24) return;

    const controller = new AbortController();
    abortRef.current = controller;

    async function fetchFlight() {
      try {
        const resp = await fetch(`/api/aircraft/${icao24!.toLowerCase()}/flight`, {
          signal: controller.signal,
        });
        if (resp.ok) {
          const body = (await resp.json()) as FlightInfo;
          setSelectedFlightInfo(body);
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') return;
      }
    }

    fetchFlight();

    return () => controller.abort();
  }, [icao24]);
}
