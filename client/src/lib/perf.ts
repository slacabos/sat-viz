const PERF_FLUSH_MS = 5_000;

type PerfMetric = {
  count: number;
  total: number;
  max: number;
  last: number;
};

const metrics = new Map<string, PerfMetric>();
let flushTimer: ReturnType<typeof setInterval> | null = null;

function ensureFlushTimer() {
  if (!import.meta.env.DEV || flushTimer) return;

  flushTimer = setInterval(() => {
    if (metrics.size === 0) return;

    const snapshot: Record<string, { count: number; avg: number; max: number; last: number }> = {};
    for (const [name, metric] of metrics) {
      snapshot[name] = {
        count: metric.count,
        avg: Number((metric.total / metric.count).toFixed(2)),
        max: Number(metric.max.toFixed(2)),
        last: Number(metric.last.toFixed(2)),
      };
    }

    console.table(snapshot);
    metrics.clear();
  }, PERF_FLUSH_MS);
}

export function recordPerf(name: string, value: number) {
  if (!import.meta.env.DEV) return;

  ensureFlushTimer();
  const current = metrics.get(name);
  if (!current) {
    metrics.set(name, { count: 1, total: value, max: value, last: value });
    return;
  }

  current.count += 1;
  current.total += value;
  current.max = Math.max(current.max, value);
  current.last = value;
}

export function timePerf<T>(name: string, fn: () => T): T {
  if (!import.meta.env.DEV) return fn();

  const startedAt = performance.now();
  try {
    return fn();
  } finally {
    recordPerf(name, performance.now() - startedAt);
  }
}
