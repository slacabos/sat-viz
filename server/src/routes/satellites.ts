import fs from 'node:fs';
import path from 'node:path';
import { Router, Request, Response } from 'express';

export const satellitesRouter = Router();

const CELESTRAK_URL =
  'https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle';
const CACHE_TTL_MS = 2 * 60 * 60 * 1000;
const DISK_CACHE_PATH = path.join(__dirname, '../../.tle-cache.json');

interface TLEEntry {
  name: string;
  line1: string;
  line2: string;
}

interface DiskCache {
  data: TLEEntry[];
  timestamp: number;
}

function parseTLEText(text: string): TLEEntry[] {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const result: TLEEntry[] = [];
  for (let i = 0; i + 2 < lines.length; i++) {
    const l1 = lines[i + 1];
    const l2 = lines[i + 2];
    if (l1?.startsWith('1 ') && l2?.startsWith('2 ')) {
      result.push({ name: lines[i], line1: l1, line2: l2 });
      i += 2;
    }
  }
  return result;
}

let memCache: DiskCache | null = null;

function loadDiskCache(): DiskCache | null {
  try {
    const raw = fs.readFileSync(DISK_CACHE_PATH, 'utf8');
    return JSON.parse(raw) as DiskCache;
  } catch {
    return null;
  }
}

function saveDiskCache(entry: DiskCache) {
  try {
    fs.writeFileSync(DISK_CACHE_PATH, JSON.stringify(entry));
  } catch (err) {
    console.warn('[satellites] could not write disk cache:', err);
  }
}

memCache = loadDiskCache();

satellitesRouter.get('/', async (_req: Request, res: Response) => {
  const now = Date.now();
  const best = memCache;

  if (best && now - best.timestamp < CACHE_TTL_MS) {
    res.setHeader('X-Cached', 'true');
    res.json(best.data);
    return;
  }

  try {
    const upstream = await fetch(CELESTRAK_URL, {
      signal: AbortSignal.timeout(30_000),
    });

    if (upstream.status === 403) {
      const body = await upstream.text();
      if (body.includes('not updated since your last successful download') && best) {
        memCache = { data: best.data, timestamp: now };
        saveDiskCache(memCache);
        res.setHeader('X-Cached', 'true');
        res.json(best.data);
        return;
      }
      throw new Error(`HTTP 403`);
    }

    if (!upstream.ok) throw new Error(`HTTP ${upstream.status}`);

    const text = await upstream.text();
    const data = parseTLEText(text);
    memCache = { data, timestamp: now };
    saveDiskCache(memCache);
    res.json(data);
  } catch (err) {
    if (best) {
      res.setHeader('X-Cached', 'true');
      res.json(best.data);
      return;
    }
    console.error('[satellites]', err);
    res.status(503).json({ error: 'Upstream unavailable' });
  }
});
