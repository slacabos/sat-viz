import { Router, Response } from 'express';
import WebSocket from 'ws';

export const vesselsRouter = Router();

const AISSTREAM_URL = 'wss://stream.aisstream.io/v0/stream';
const MAX_BACKOFF_MS = 30_000;
const KEEPALIVE_MS = 25_000;

type RelayStatus = 'connecting' | 'connected' | 'disconnected';

interface VesselPosition {
  mmsi: string;
  shipName: string | null;
  lat: number;
  lon: number;
  sog: number | null;
  cog: number | null;
  heading: number | null;
  shipType: number | null;
  lastUpdate: number;
}

interface AisStreamMessage {
  MessageType?: string;
  MetaData?: {
    MMSI?: string | number;
    ShipName?: string;
    ShipType?: number;
  };
  Message?: {
    PositionReport?: {
      Latitude?: number;
      Longitude?: number;
      Sog?: number;
      Cog?: number;
      TrueHeading?: number;
    };
  };
}

const clients = new Set<Response>();
let upstream: WebSocket | null = null;
let status: RelayStatus = 'disconnected';
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let keepaliveTimer: ReturnType<typeof setInterval> | null = null;
let backoff = 2_000;

function sendEvent(res: Response, event: string, data: unknown) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function broadcast(event: string, data: unknown) {
  for (const client of clients) {
    sendEvent(client, event, data);
  }
}

function setStatus(nextStatus: RelayStatus, message?: string) {
  status = nextStatus;
  broadcast('status', { status, message });
}

function parseVessel(raw: WebSocket.RawData): VesselPosition | null {
  let msg: AisStreamMessage;
  try {
    msg = JSON.parse(raw.toString()) as AisStreamMessage;
  } catch {
    return null;
  }

  if (msg.MessageType !== 'PositionReport') return null;

  const meta = msg.MetaData;
  const report = msg.Message?.PositionReport;
  if (!meta || !report || meta.MMSI == null) return null;

  const lat = report.Latitude;
  const lon = report.Longitude;
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;
  if (lat === 0 && lon === 0) return null;

  return {
    mmsi: String(meta.MMSI),
    shipName: meta.ShipName?.trim() || null,
    lat,
    lon,
    sog: report.Sog ?? null,
    cog: report.Cog ?? null,
    heading: report.TrueHeading !== 511 ? (report.TrueHeading ?? null) : null,
    shipType: meta.ShipType ?? null,
    lastUpdate: Date.now(),
  };
}

function clearRetry() {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

function closeUpstream() {
  clearRetry();
  if (upstream) {
    upstream.removeAllListeners();
    upstream.close();
    upstream = null;
  }
}

function scheduleReconnect() {
  clearRetry();
  if (clients.size === 0) return;

  retryTimer = setTimeout(() => {
    retryTimer = null;
    backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
    connectUpstream();
  }, backoff);
}

function connectUpstream() {
  if (upstream || retryTimer || clients.size === 0) return;

  const apiKey = process.env.AISSTREAM_KEY;
  if (!apiKey || apiKey === 'your_aisstream_api_key_here') {
    setStatus('disconnected', 'AISSTREAM_KEY is not configured');
    return;
  }

  setStatus('connecting');
  const ws = new WebSocket(AISSTREAM_URL);
  upstream = ws;

  ws.on('open', () => {
    backoff = 2_000;
    setStatus('connected');
    ws.send(
      JSON.stringify({
        APIKey: apiKey,
        BoundingBoxes: [
          [
            [-90, -180],
            [90, 180],
          ],
        ],
        FilterMessageTypes: ['PositionReport'],
      })
    );
  });

  ws.on('message', (raw) => {
    const vessel = parseVessel(raw);
    if (vessel) broadcast('vessel', vessel);
  });

  ws.on('close', () => {
    if (upstream === ws) upstream = null;
    setStatus('disconnected');
    scheduleReconnect();
  });

  ws.on('error', () => {
    if (upstream === ws) upstream = null;
    setStatus('disconnected');
    ws.close();
  });
}

function addClient(res: Response) {
  clients.add(res);
  sendEvent(res, 'status', { status });

  if (!keepaliveTimer) {
    keepaliveTimer = setInterval(() => {
      for (const client of clients) {
        client.write(': keepalive\n\n');
      }
    }, KEEPALIVE_MS);
  }

  connectUpstream();
}

function removeClient(res: Response) {
  clients.delete(res);

  if (clients.size === 0) {
    if (keepaliveTimer) {
      clearInterval(keepaliveTimer);
      keepaliveTimer = null;
    }
    closeUpstream();
    status = 'disconnected';
  }
}

vesselsRouter.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  addClient(res);

  req.on('close', () => {
    removeClient(res);
  });
});
