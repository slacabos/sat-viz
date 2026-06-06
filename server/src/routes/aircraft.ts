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

const TOKEN_URL =
  'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';

let tokenCache: { token: string; expiresAt: number } | null = null;

async function getToken(): Promise<string | null> {
  const clientId = process.env.OPENSKY_CLIENT_ID;
  const clientSecret = process.env.OPENSKY_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.token;
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  });

  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(10_000),
  });

  if (!resp.ok) throw new Error(`Token fetch failed: ${resp.status}`);

  const data = (await resp.json()) as { access_token: string; expires_in: number };
  tokenCache = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return tokenCache.token;
}

interface FlightInfo {
  departureAirport: string | null;
  arrivalAirport: string | null;
}

interface OpenSkyFlight {
  icao24: string;
  firstSeen: number;
  estDepartureAirport: string | null;
  lastSeen: number;
  estArrivalAirport: string | null;
}

const dataCache = new Map<string, Cache>();
const CACHE_TTL_MS = 12_000;
const flightCache = new Map<string, { data: FlightInfo; timestamp: number }>();
const FLIGHT_CACHE_TTL_MS = 5 * 60_000;
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

async function fetchUpstream(params: URLSearchParams, token: string | null) {
  const url = `https://opensky-network.org/api/states/all${params.size ? '?' + params : ''}`;
  return fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal: AbortSignal.timeout(10_000),
  });
}

aircraftRouter.get('/:icao24/flight', async (req: Request, res: Response) => {
  const icao24 = String(req.params.icao24 ?? '').toLowerCase();
  if (!icao24 || !/^[0-9a-f]{6}$/.test(icao24)) {
    res.status(400).json({ error: 'Invalid icao24' });
    return;
  }

  const now = Date.now();
  const cached = flightCache.get(icao24);
  if (cached && now - cached.timestamp < FLIGHT_CACHE_TTL_MS) {
    res.setHeader('X-Cached', 'true');
    res.json(cached.data);
    return;
  }

  const end = Math.floor(now / 1000);
  const begin = end - 86400;
  const params = new URLSearchParams({ icao24, begin: String(begin), end: String(end) });
  const url = `https://opensky-network.org/api/flights/aircraft?${params}`;

  try {
    const token = await getToken();
    const upstream = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(10_000),
    });

    if (upstream.status === 404 || upstream.status === 204) {
      const result: FlightInfo = { departureAirport: null, arrivalAirport: null };
      flightCache.set(icao24, { data: result, timestamp: now });
      res.json(result);
      return;
    }

    if (!upstream.ok) {
      res.status(upstream.status).json({ error: 'OpenSky error' });
      return;
    }

    const flights = (await upstream.json()) as OpenSkyFlight[];

    if (!Array.isArray(flights) || flights.length === 0) {
      const result: FlightInfo = { departureAirport: null, arrivalAirport: null };
      flightCache.set(icao24, { data: result, timestamp: now });
      res.json(result);
      return;
    }

    flights.sort((a, b) => b.lastSeen - a.lastSeen);
    const latest = flights[0];
    const result: FlightInfo = {
      departureAirport: latest.estDepartureAirport ?? null,
      arrivalAirport: latest.estArrivalAirport ?? null,
    };
    flightCache.set(icao24, { data: result, timestamp: now });
    res.json(result);
  } catch {
    res.json({ departureAirport: null, arrivalAirport: null });
  }
});

aircraftRouter.get('/', async (req: Request, res: Response) => {
  const now = Date.now();

  const { lamin, lamax, lomin, lomax } = req.query;
  const params = new URLSearchParams();
  if (lamin) params.set('lamin', String(lamin));
  if (lamax) params.set('lamax', String(lamax));
  if (lomin) params.set('lomin', String(lomin));
  if (lomax) params.set('lomax', String(lomax));

  const cacheKey = BOUNDS_KEYS.map((k) => `${k}=${params.get(k) ?? ''}`).join('&');
  const cached = dataCache.get(cacheKey);

  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    res.setHeader('X-Cached', 'true');
    res.json({ time: Math.floor(cached.timestamp / 1000), states: cached.data });
    return;
  }

  try {
    let token = await getToken();
    let upstream = await fetchUpstream(params, token);

    // On 401, clear token cache and retry once with a fresh token
    if (upstream.status === 401) {
      tokenCache = null;
      token = await getToken();
      upstream = await fetchUpstream(params, token);
    }

    if (!upstream.ok) {
      if (cached) {
        res.setHeader('X-Cached', 'true');
        res.json({ time: Math.floor(cached.timestamp / 1000), states: cached.data });
        return;
      }
      res.status(upstream.status).json({ error: 'OpenSky error' });
      return;
    }

    const body = (await upstream.json()) as { time: number; states: unknown[][] | null };
    const states = (body.states ?? [])
      .filter((s) => s[5] != null && s[6] != null)
      .map(mapState);

    dataCache.set(cacheKey, { data: states, timestamp: now });
    res.json({ time: body.time, states });
  } catch {
    if (cached) {
      res.setHeader('X-Cached', 'true');
      res.json({ time: Math.floor(cached.timestamp / 1000), states: cached.data });
      return;
    }
    res.status(503).json({ error: 'Upstream unavailable' });
  }
});
