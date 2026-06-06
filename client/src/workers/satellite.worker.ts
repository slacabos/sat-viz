import {
  degreesLat,
  degreesLong,
  eciToGeodetic,
  gstime,
  propagate,
  twoline2satrec,
  type EciVec3,
  type SatRec,
} from '../lib/satellite';
import type { TLERecord, SatellitePosition } from '../types/satellite';

type InMsg = { type: 'start' } | { type: 'stop' };
type OutMsg =
  | { type: 'positions'; data: SatellitePosition[] }
  | { type: 'status'; tleCount: number; fetchedAt: number }
  | { type: 'error'; message: string };

const TLE_URL = '/api/satellites';
const PROPAGATE_INTERVAL_MS = 10_000;
const TLE_REFRESH_INTERVAL_MS = 2 * 60 * 60 * 1000;

interface SatRecord {
  satrec: SatRec;
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
          const satrec = twoline2satrec(r.line1, r.line2);
          if (satrec.error !== 0) return null;
          return {
            satrec,
            name: r.name,
            id: parseInt(r.line1.substring(2, 7).trim(), 10),
            inclination: satrec.inclo * (180 / Math.PI),
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
  const sampleTimeMs = Date.now();
  const date = new Date(sampleTimeMs);
  const targetTimeMs = sampleTimeMs + PROPAGATE_INTERVAL_MS;
  const targetDate = new Date(targetTimeMs);
  const positions: SatellitePosition[] = [];

  for (const rec of records) {
    try {
      const posVel = propagate(rec.satrec, date);
      if (!posVel || typeof posVel.position === 'boolean') continue;
      const targetPosVel = propagate(rec.satrec, targetDate);
      if (!targetPosVel || typeof targetPosVel.position === 'boolean') continue;

      const gmst = gstime(date);
      const geo = eciToGeodetic(posVel.position as EciVec3<number>, gmst);
      const targetGmst = gstime(targetDate);
      const targetGeo = eciToGeodetic(targetPosVel.position as EciVec3<number>, targetGmst);

      const lat = degreesLat(geo.latitude);
      const lng = degreesLong(geo.longitude);
      const altKm = geo.height;
      const targetLat = degreesLat(targetGeo.latitude);
      const targetLng = degreesLong(targetGeo.longitude);
      const targetAltKm = targetGeo.height;

      if (
        isNaN(lat) ||
        isNaN(lng) ||
        isNaN(altKm) ||
        isNaN(targetLat) ||
        isNaN(targetLng) ||
        isNaN(targetAltKm)
      ) {
        continue;
      }

      positions.push({
        id: rec.id,
        name: rec.name,
        lat,
        lng,
        altKm,
        inclination: rec.inclination,
        targetLat,
        targetLng,
        targetAltKm,
        sampleTimeMs,
        targetTimeMs,
      });
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
