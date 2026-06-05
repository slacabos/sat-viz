import { useEffect, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';
import type { VesselPosition } from '../types/vessel';

const WS_URL = 'wss://stream.aisstream.io/v0/stream';
const BATCH_FLUSH_MS = 2_000;
const MAX_BACKOFF_MS = 30_000;

export function useVesselStream() {
  const bulkUpsertVessels = useAppStore((s) => s.bulkUpsertVessels);
  const setLastUpdated = useAppStore((s) => s.setLastUpdated);
  const setWsStatus = useAppStore((s) => s.setWsStatus);
  const buffer = useRef(new Map<string, VesselPosition>());
  const backoff = useRef(2_000);
  const wsRef = useRef<WebSocket | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const apiKey = import.meta.env.VITE_AISSTREAM_KEY as string | undefined;
    let disposed = false;

    // Flush buffer to store every 2s
    const flushTimer = setInterval(() => {
      if (buffer.current.size > 0) {
        bulkUpsertVessels(Array.from(buffer.current.values()));
        setLastUpdated('vessels', Date.now());
        buffer.current.clear();
      }
    }, BATCH_FLUSH_MS);

    function connect() {
      if (disposed) return;

      setWsStatus('connecting');
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        if (disposed) {
          ws.close();
          return;
        }

        backoff.current = 2_000;
        setWsStatus('connected');
        ws.send(
          JSON.stringify({
            APIKey: apiKey ?? '',
            BoundingBoxes: [
              [
                [-90, -180],
                [90, 180],
              ],
            ],
            FilterMessageTypes: ['PositionReport'],
          })
        );
      };

      ws.onmessage = (e) => {
        if (disposed) return;

        try {
          const msg = JSON.parse(e.data as string);
          if (msg.MessageType !== 'PositionReport') return;
          const meta = msg.MetaData;
          const report = msg.Message?.PositionReport;
          if (!report || !meta) return;

          const vessel: VesselPosition = {
            mmsi: String(meta.MMSI),
            shipName: meta.ShipName?.trim() || null,
            lat: report.Latitude,
            lon: report.Longitude,
            sog: report.Sog ?? null,
            cog: report.Cog ?? null,
            heading: report.TrueHeading !== 511 ? report.TrueHeading : null,
            shipType: meta.ShipType ?? null,
            lastUpdate: Date.now(),
          };

          if (vessel.lat !== 0 || vessel.lon !== 0) {
            buffer.current.set(vessel.mmsi, vessel);
          }
        } catch {
          // ignore malformed
        }
      };

      ws.onclose = () => {
        if (disposed) return;

        setWsStatus('disconnected');
        retryTimer.current = setTimeout(() => {
          if (disposed) return;

          backoff.current = Math.min(backoff.current * 2, MAX_BACKOFF_MS);
          connect();
        }, backoff.current);
      };

      ws.onerror = () => {
        if (!disposed) ws.close();
      };
    }

    connect();

    return () => {
      disposed = true;
      clearInterval(flushTimer);
      if (retryTimer.current) clearTimeout(retryTimer.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.onerror = null;
        wsRef.current.onmessage = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [bulkUpsertVessels, setLastUpdated, setWsStatus]);
}
