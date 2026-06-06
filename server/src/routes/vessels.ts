import { randomUUID } from 'node:crypto';
import { Router, Response } from 'express';
import Redis from 'ioredis';
import WebSocket from 'ws';

export const vesselsRouter = Router();

const AISSTREAM_URL = 'wss://stream.aisstream.io/v0/stream';
const MAX_BACKOFF_MS = 30_000;
const KEEPALIVE_MS = 25_000;
const LEADER_TTL_MS = 45_000;
const LEADER_RENEW_MS = 15_000;
const ELECTION_RETRY_MS = 5_000;
const CACHE_TTL_MS = 10 * 60_000;
const CACHE_PRUNE_MS = 60_000;
const CACHE_REPLAY_LIMIT = 10_000;
const CACHE_REPLAY_BATCH_SIZE = 500;
const CACHE_MAX_ENTRIES = 50_000;

const LEADER_KEY = 'sat-viz:vessels:leader';
const DATA_KEY = 'sat-viz:vessels:data';
const SEEN_KEY = 'sat-viz:vessels:seen';
const STATUS_KEY = 'sat-viz:vessels:status:value';
const UPDATE_CHANNEL = 'sat-viz:vessels:updates';
const STATUS_CHANNEL = 'sat-viz:vessels:status';

const instanceId = randomUUID();

type RelayStatus = 'connecting' | 'connected' | 'disconnected';

interface RelayStatusPayload {
  status: RelayStatus;
  message?: string;
}

interface PubSubStatusPayload extends RelayStatusPayload {
  origin: string;
}

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
let redis: Redis | null = null;
let subscriber: Redis | null = null;
let upstream: WebSocket | null = null;
let status: RelayStatusPayload = { status: 'disconnected' };
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let keepaliveTimer: ReturnType<typeof setInterval> | null = null;
let leaderRenewTimer: ReturnType<typeof setInterval> | null = null;
let electionTimer: ReturnType<typeof setTimeout> | null = null;
let pruneTimer: ReturnType<typeof setInterval> | null = null;
let backoff = 2_000;
let hasLeadership = false;
let initialized = false;

const renewLeaderScript = `
  if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("PEXPIRE", KEYS[1], ARGV[2])
  end
  return 0
`;

const releaseLeaderScript = `
  if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("DEL", KEYS[1])
  end
  return 0
`;

function getRedis() {
  if (!redis) throw new Error('Valkey has not been initialized');
  return redis;
}

function getSubscriber() {
  if (!subscriber) throw new Error('Valkey subscriber has not been initialized');
  return subscriber;
}

function sendEvent(res: Response, event: string, data: unknown) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function broadcast(event: string, data: unknown) {
  for (const client of clients) {
    sendEvent(client, event, data);
  }
}

async function publishStatus(nextStatus: RelayStatus, message?: string) {
  const payload: RelayStatusPayload = { status: nextStatus, message };
  const pubSubPayload: PubSubStatusPayload = { ...payload, origin: instanceId };
  status = payload;
  broadcast('status', payload);

  await getRedis()
    .multi()
    .set(STATUS_KEY, JSON.stringify(payload), 'PX', LEADER_TTL_MS)
    .publish(STATUS_CHANNEL, JSON.stringify(pubSubPayload))
    .exec();
}

function applyStatusPayload(payload: RelayStatusPayload) {
  status = payload;
  broadcast('status', payload);
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

function clearElection() {
  if (electionTimer) {
    clearTimeout(electionTimer);
    electionTimer = null;
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

function stopLeaderRenewal() {
  if (leaderRenewTimer) {
    clearInterval(leaderRenewTimer);
    leaderRenewTimer = null;
  }
}

function startKeepalive() {
  if (keepaliveTimer) return;

  keepaliveTimer = setInterval(() => {
    for (const client of clients) {
      client.write(': keepalive\n\n');
    }
  }, KEEPALIVE_MS);
}

function stopKeepalive() {
  if (keepaliveTimer) {
    clearInterval(keepaliveTimer);
    keepaliveTimer = null;
  }
}

function startPruning() {
  if (pruneTimer) return;

  pruneTimer = setInterval(() => {
    pruneCache().catch((err: unknown) => {
      console.error('Failed to prune vessel cache', err);
    });
  }, CACHE_PRUNE_MS);
}

function stopPruning() {
  if (pruneTimer) {
    clearInterval(pruneTimer);
    pruneTimer = null;
  }
}

async function scheduleReconnect() {
  clearRetry();
  if (!hasLeadership || clients.size === 0) return;

  retryTimer = setTimeout(() => {
    retryTimer = null;
    backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
    connectUpstream().catch((err: unknown) => {
      console.error('Failed to reconnect AISStream', err);
    });
  }, backoff);
}

async function saveAndPublishVessel(vessel: VesselPosition) {
  await getRedis()
    .multi()
    .hset(DATA_KEY, vessel.mmsi, JSON.stringify(vessel))
    .zadd(SEEN_KEY, vessel.lastUpdate, vessel.mmsi)
    .publish(UPDATE_CHANNEL, JSON.stringify(vessel))
    .exec();
}

async function connectUpstream() {
  if (upstream || retryTimer || !hasLeadership || clients.size === 0) return;

  const apiKey = process.env.AISSTREAM_KEY;
  if (!apiKey || apiKey === 'your_aisstream_api_key_here') {
    await publishStatus('disconnected', 'AISSTREAM_KEY is not configured');
    return;
  }

  await publishStatus('connecting');
  const ws = new WebSocket(AISSTREAM_URL);
  upstream = ws;

  ws.on('open', () => {
    backoff = 2_000;
    publishStatus('connected').catch((err: unknown) => {
      console.error('Failed to publish vessel relay status', err);
    });
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
    if (!vessel) return;

    saveAndPublishVessel(vessel).catch((err: unknown) => {
      console.error('Failed to publish vessel update', err);
    });
  });

  ws.on('close', () => {
    if (upstream === ws) upstream = null;
    publishStatus('disconnected').catch((err: unknown) => {
      console.error('Failed to publish vessel relay status', err);
    });
    scheduleReconnect().catch((err: unknown) => {
      console.error('Failed to schedule AISStream reconnect', err);
    });
  });

  ws.on('error', () => {
    if (upstream === ws) upstream = null;
    publishStatus('disconnected').catch((err: unknown) => {
      console.error('Failed to publish vessel relay status', err);
    });
    ws.close();
  });
}

function scheduleElection() {
  clearElection();
  if (clients.size === 0 || hasLeadership) return;

  electionTimer = setTimeout(() => {
    electionTimer = null;
    attemptLeadership().catch((err: unknown) => {
      console.error('Failed to attempt vessel relay leadership', err);
      scheduleElection();
    });
  }, ELECTION_RETRY_MS);
}

async function releaseLeadership() {
  if (!hasLeadership) return;

  hasLeadership = false;
  stopLeaderRenewal();
  closeUpstream();
  await getRedis().eval(releaseLeaderScript, 1, LEADER_KEY, instanceId);
}

async function renewLeadership() {
  const renewed = await getRedis().eval(renewLeaderScript, 1, LEADER_KEY, instanceId, LEADER_TTL_MS);
  if (renewed === 1) {
    await getRedis().set(STATUS_KEY, JSON.stringify(status), 'PX', LEADER_TTL_MS);
    return;
  }

  hasLeadership = false;
  stopLeaderRenewal();
  closeUpstream();
  await publishStatus('disconnected', 'Vessel relay leadership was lost');
  scheduleElection();
}

function startLeaderRenewal() {
  stopLeaderRenewal();
  leaderRenewTimer = setInterval(() => {
    renewLeadership().catch((err: unknown) => {
      console.error('Failed to renew vessel relay leadership', err);
    });
  }, LEADER_RENEW_MS);
}

async function attemptLeadership() {
  if (hasLeadership || clients.size === 0) return;

  const acquired = await getRedis().set(LEADER_KEY, instanceId, 'PX', LEADER_TTL_MS, 'NX');
  if (acquired !== 'OK') {
    scheduleElection();
    return;
  }

  hasLeadership = true;
  startLeaderRenewal();
  await connectUpstream();
}

async function pruneCache() {
  const client = getRedis();
  const cutoff = Date.now() - CACHE_TTL_MS;
  const staleMmsis = await client.zrangebyscore(SEEN_KEY, '-inf', cutoff);

  if (staleMmsis.length > 0) {
    await client.multi().hdel(DATA_KEY, ...staleMmsis).zrem(SEEN_KEY, ...staleMmsis).exec();
  }

  const cacheSize = await client.zcard(SEEN_KEY);
  if (cacheSize <= CACHE_MAX_ENTRIES) return;

  const overflow = cacheSize - CACHE_MAX_ENTRIES;
  const oldestMmsis = await client.zrange(SEEN_KEY, 0, overflow - 1);
  if (oldestMmsis.length > 0) {
    await client.multi().hdel(DATA_KEY, ...oldestMmsis).zrem(SEEN_KEY, ...oldestMmsis).exec();
  }
}

async function replayCache(res: Response) {
  await pruneCache();

  const client = getRedis();
  const mmsis = await client.zrevrange(SEEN_KEY, 0, CACHE_REPLAY_LIMIT - 1);

  for (let i = 0; i < mmsis.length && clients.has(res); i += CACHE_REPLAY_BATCH_SIZE) {
    const batchMmsis = mmsis.slice(i, i + CACHE_REPLAY_BATCH_SIZE);
    const vessels = await client.hmget(DATA_KEY, ...batchMmsis);

    for (const serialized of vessels) {
      if (!serialized || !clients.has(res)) continue;

      try {
        sendEvent(res, 'vessel', JSON.parse(serialized) as VesselPosition);
      } catch {
        // Ignore malformed cache entries; the next prune or live update will repair state.
      }
    }

    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

async function loadStatus() {
  const serialized = await getRedis().get(STATUS_KEY);
  if (!serialized) return;

  try {
    status = JSON.parse(serialized) as RelayStatusPayload;
  } catch {
    status = { status: 'disconnected' };
  }
}

async function addClient(res: Response) {
  clients.add(res);
  sendEvent(res, 'status', status);
  startKeepalive();
  startPruning();

  await replayCache(res);
  await attemptLeadership();
}

async function removeClient(res: Response) {
  clients.delete(res);

  if (clients.size > 0) return;

  stopKeepalive();
  stopPruning();
  clearElection();
  await releaseLeadership();
  status = { status: 'disconnected' };
}

function handlePubSubMessage(channel: string, message: string) {
  if (channel === UPDATE_CHANNEL) {
    try {
      const vessel = JSON.parse(message) as VesselPosition;
      broadcast('vessel', vessel);
    } catch {
      // Ignore malformed pub/sub payloads.
    }
    return;
  }

  if (channel === STATUS_CHANNEL) {
    try {
      const { origin, ...payload } = JSON.parse(message) as PubSubStatusPayload;
      if (origin === instanceId) return;
      applyStatusPayload(payload);
    } catch {
      // Ignore malformed pub/sub payloads.
    }
  }
}

export async function initializeVesselRelay() {
  if (initialized) return;

  const valkeyUrl = process.env.VALKEY_URL;
  if (!valkeyUrl) {
    throw new Error('VALKEY_URL is required to start the server');
  }

  redis = new Redis(valkeyUrl, { lazyConnect: true, maxRetriesPerRequest: 3 });
  subscriber = new Redis(valkeyUrl, { lazyConnect: true, maxRetriesPerRequest: null });

  redis.on('error', (err) => {
    console.error('Valkey command client error', err);
  });
  subscriber.on('error', (err) => {
    console.error('Valkey subscriber client error', err);
  });

  await redis.connect();
  await subscriber.connect();
  await redis.ping();

  getSubscriber().on('message', handlePubSubMessage);
  await getSubscriber().subscribe(UPDATE_CHANNEL, STATUS_CHANNEL);
  await loadStatus();

  initialized = true;
}

vesselsRouter.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  addClient(res).catch((err: unknown) => {
    sendEvent(res, 'status', { status: 'disconnected', message: 'Vessel relay is unavailable' });
    removeClient(res).catch((cleanupErr: unknown) => {
      console.error('Failed to clean up vessel stream client after add failure', cleanupErr);
    });
    console.error('Failed to add vessel stream client', err);
  });

  req.on('close', () => {
    removeClient(res).catch((err: unknown) => {
      console.error('Failed to remove vessel stream client', err);
    });
  });
});
