import * as satellite from 'satellite.js';
import type { TLERecord, SatellitePosition } from '../types/satellite';

type InMsg = { type: 'start' } | { type: 'stop' };
type OutMsg =
  | { type: 'positions'; data: SatellitePosition[] }
  | { type: 'status'; tleCount: number; fetchedAt: number }
  | { type: 'error'; message: string };

const TLE_URL = 'https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=json';
const PROPAGATE_INTERVAL_MS = 10_000;
const TLE_REFRESH_INTERVAL_MS = 2 * 60 * 60 * 1000;

interface SatRecord {
  satrec: satellite.SatRec;
  name: string;
  id: number;
  inclination: number;
}

let records: SatRecord[] = [];
let propagateTimer: ReturnType<typeof setInterval> | null = null;
let refreshTimer: ReturnType<typeof setInterval> | null = null;

function post(msg: OutMsg) {
  self.postMessage(msg);
}

async function fetchTLEs() {
  try {
    const resp = await fetch(TLE_URL);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data: TLERecord[] = await resp.json();

    records = data
      .map((r) => {
        try {
          const satrec = satellite.twoline2satrec(r.TLE_LINE1, r.TLE_LINE2);
          if (satrec.error !== 0) return null;
          return {
            satrec,
            name: r.OBJECT_NAME,
            id: r.NORAD_CAT_ID,
            inclination: r.INCLINATION,
          };
        } catch {
          return null;
        }
      })
      .filter((r): r is SatRecord => r !== null);

    post({ type: 'status', tleCount: records.length, fetchedAt: Date.now() });
  } catch (err) {
    post({ type: 'error', message: String(err) });
  }
}

function propagateAll() {
  if (records.length === 0) return;
  const date = new Date();
  const positions: SatellitePosition[] = [];

  for (const rec of records) {
    try {
      const posVel = satellite.propagate(rec.satrec, date);
      if (typeof posVel.position === 'boolean') continue;

      const gmst = satellite.gstime(date);
      const geo = satellite.eciToGeodetic(posVel.position as satellite.EciVec3<number>, gmst);

      const lat = satellite.degreesLat(geo.latitude);
      const lng = satellite.degreesLong(geo.longitude);
      const altKm = geo.height;

      if (isNaN(lat) || isNaN(lng) || isNaN(altKm)) continue;

      positions.push({ id: rec.id, name: rec.name, lat, lng, altKm, inclination: rec.inclination });
    } catch {
      // skip bad records
    }
  }

  post({ type: 'positions', data: positions });
}

self.onmessage = async (e: MessageEvent<InMsg>) => {
  if (e.data.type === 'start') {
    await fetchTLEs();
    propagateAll();
    propagateTimer = setInterval(propagateAll, PROPAGATE_INTERVAL_MS);
    refreshTimer = setInterval(fetchTLEs, TLE_REFRESH_INTERVAL_MS);
  } else if (e.data.type === 'stop') {
    if (propagateTimer) clearInterval(propagateTimer);
    if (refreshTimer) clearInterval(refreshTimer);
  }
};
