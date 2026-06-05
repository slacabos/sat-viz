import { Router, Request, Response } from 'express';

export const aircraftRouter = Router();

interface AircraftState {
  icao24: string;
  callsign: string | null;
  originCountry: string;
  lon: number | null;
  lat: number | null;
  baroAltitude: number | null;
  onGround: boolean;
  velocity: number | null;
  trueTrack: number | null;
  verticalRate: number | null;
  geoAltitude: number | null;
}

interface Cache {
  data: AircraftState[];
  timestamp: number;
}

const cache = new Map<string, Cache>();
const CACHE_TTL_MS = 12_000;
const BOUNDS_KEYS = ['lamin', 'lamax', 'lomin', 'lomax'] as const;

function mapState(s: unknown[]): AircraftState {
  return {
    icao24: s[0] as string,
    callsign: (s[1] as string)?.trim() || null,
    originCountry: s[2] as string,
    lon: s[5] as number | null,
    lat: s[6] as number | null,
    baroAltitude: s[7] as number | null,
    onGround: s[8] as boolean,
    velocity: s[9] as number | null,
    trueTrack: s[10] as number | null,
    verticalRate: s[11] as number | null,
    geoAltitude: s[13] as number | null,
  };
}

aircraftRouter.get('/', async (req: Request, res: Response) => {
  const now = Date.now();

  const { lamin, lamax, lomin, lomax } = req.query;
  const params = new URLSearchParams();
  if (lamin) params.set('lamin', String(lamin));
  if (lamax) params.set('lamax', String(lamax));
  if (lomin) params.set('lomin', String(lomin));
  if (lomax) params.set('lomax', String(lomax));
  const cacheKey = BOUNDS_KEYS.map((key) => `${key}=${params.get(key) ?? ''}`).join('&');
  const cached = cache.get(cacheKey);

  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    res.setHeader('X-Cached', 'true');
    res.json({ time: Math.floor(cached.timestamp / 1000), states: cached.data });
    return;
  }

  const user = process.env.OPENSKY_USER;
  const pass = process.env.OPENSKY_PASS;
  const auth = user && pass ? `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}` : undefined;

  const url = `https://opensky-network.org/api/states/all${params.size ? '?' + params : ''}`;

  try {
    const upstream = await fetch(url, {
      headers: auth ? { Authorization: auth } : {},
      signal: AbortSignal.timeout(10_000),
    });

    if (!upstream.ok) {
      if (cached) {
        res.setHeader('X-Cached', 'true');
        res.json({ time: Math.floor(cached.timestamp / 1000), states: cached.data });
        return;
      }
      res.status(upstream.status).json({ error: 'OpenSky error' });
      return;
    }

    const body = await upstream.json() as { time: number; states: unknown[][] | null };
    const states = (body.states ?? []).filter((s) => s[5] != null && s[6] != null).map(mapState);

    cache.set(cacheKey, { data: states, timestamp: now });
    res.json({ time: body.time, states });
  } catch (err) {
    if (cached) {
      res.setHeader('X-Cached', 'true');
      res.json({ time: Math.floor(cached.timestamp / 1000), states: cached.data });
      return;
    }
    res.status(503).json({ error: 'Upstream unavailable' });
  }
});
