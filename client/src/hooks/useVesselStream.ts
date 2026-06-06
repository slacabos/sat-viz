import { useEffect, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';
import { recordPerf, timePerf } from '../lib/perf';
import type { VesselPosition } from '../types/vessel';

const BATCH_FLUSH_MS = 5_000;
const STREAM_URL = '/api/vessels/stream';

type VesselStatusEvent = {
  status: 'connecting' | 'connected' | 'disconnected';
  message?: string;
};

export function useVesselStream() {
  const bulkUpsertVessels = useAppStore((s) => s.bulkUpsertVessels);
  const setLastUpdated = useAppStore((s) => s.setLastUpdated);
  const setWsStatus = useAppStore((s) => s.setWsStatus);
  const buffer = useRef(new Map<string, VesselPosition>());
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    let disposed = false;

    // Flush buffer to store every 5s
    const flushTimer = setInterval(() => {
      if (buffer.current.size > 0) {
        const vessels = Array.from(buffer.current.values());
        recordPerf('vessels.flush.batchSize', vessels.length);
        timePerf('vessels.flush.storeMs', () => bulkUpsertVessels(vessels));
        setLastUpdated('vessels', Date.now());
        buffer.current.clear();
      }
    }, BATCH_FLUSH_MS);

    setWsStatus('connecting');
    const eventSource = new EventSource(STREAM_URL);
    eventSourceRef.current = eventSource;

    eventSource.addEventListener('status', (e) => {
      if (disposed) return;
      try {
        const data = JSON.parse(e.data) as VesselStatusEvent;
        setWsStatus(data.status);
        if (data.message) console.warn(data.message);
      } catch {
        setWsStatus('disconnected');
      }
    });

    eventSource.addEventListener('vessel', (e) => {
      if (disposed) return;
      try {
        const vessel = JSON.parse(e.data) as VesselPosition;
        buffer.current.set(vessel.mmsi, vessel);
      } catch {
        // ignore malformed
      }
    });

    eventSource.onerror = () => {
      if (!disposed) setWsStatus('disconnected');
    };

    return () => {
      disposed = true;
      clearInterval(flushTimer);
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [bulkUpsertVessels, setLastUpdated, setWsStatus]);
}
