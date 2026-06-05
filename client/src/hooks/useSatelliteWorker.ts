import { useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';
import type { SatellitePosition } from '../types/satellite';

type WorkerOutMsg =
  | { type: 'positions'; data: SatellitePosition[] }
  | { type: 'status'; tleCount: number; fetchedAt: number }
  | { type: 'error'; message: string };

export function useSatelliteWorker() {
  const setSatellites = useAppStore((s) => s.setSatellites);
  const setLastUpdated = useAppStore((s) => s.setLastUpdated);

  useEffect(() => {
    const worker = new Worker(new URL('../workers/satellite.worker.ts', import.meta.url), {
      type: 'module',
    });

    worker.onmessage = (e: MessageEvent<WorkerOutMsg>) => {
      if (e.data.type === 'positions') {
        setSatellites(e.data.data);
        setLastUpdated('satellites', Date.now());
      }
    };

    worker.postMessage({ type: 'start' });

    return () => {
      worker.postMessage({ type: 'stop' });
      worker.terminate();
    };
  }, [setSatellites, setLastUpdated]);
}
