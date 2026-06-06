import { useEffect, useRef, useState } from 'react';
import type { FlightInfo } from '../types/aircraft';

export function useAircraftFlight(icao24: string | null) {
  const [data, setData] = useState<FlightInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    abortRef.current?.abort();

    if (!icao24) return;

    const controller = new AbortController();
    abortRef.current = controller;

    async function fetchFlight() {
      setData(null);
      setLoading(true);
      try {
        const resp = await fetch(`/api/aircraft/${icao24!.toLowerCase()}/flight`, {
          signal: controller.signal,
        });
        if (resp.ok) {
          const body = (await resp.json()) as FlightInfo;
          setData(body);
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') return;
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    fetchFlight();

    return () => controller.abort();
  }, [icao24]);

  return { data, loading };
}
