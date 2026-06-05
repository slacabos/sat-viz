import { useAppStore } from '../store/useAppStore';

function fmt(ts: number | null): string {
  if (!ts) return '—';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  return `${Math.floor(s / 60)}m ago`;
}

export function StatusBar() {
  const satellites = useAppStore((s) => s.satellites);
  const aircraft = useAppStore((s) => s.aircraft);
  const vessels = useAppStore((s) => s.vessels);
  const lastUpdated = useAppStore((s) => s.lastUpdated);
  const wsStatus = useAppStore((s) => s.wsStatus);

  const wsColor =
    wsStatus === 'connected' ? '#10b981' : wsStatus === 'connecting' ? '#f59e0b' : '#ef4444';

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        height: 36,
        background: 'rgba(8,8,18,0.85)',
        borderTop: '1px solid rgba(255,255,255,0.08)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 20px',
        gap: 24,
        zIndex: 100,
        fontSize: 12,
        color: 'rgba(255,255,255,0.5)',
      }}
    >
      <span style={{ color: '#22d3ee' }}>🛰 {satellites.length.toLocaleString()}</span>
      <span style={{ opacity: 0.4 }}>updated {fmt(lastUpdated.satellites)}</span>

      <span style={{ color: '#f59e0b', marginLeft: 12 }}>
        ✈ {aircraft.filter((a) => !a.onGround).length.toLocaleString()}
      </span>
      <span style={{ opacity: 0.4 }}>updated {fmt(lastUpdated.aircraft)}</span>

      <span style={{ color: '#10b981', marginLeft: 12 }}>🚢 {vessels.length.toLocaleString()}</span>
      <span style={{ color: wsColor, fontSize: 10 }}>● {wsStatus}</span>

      <span style={{ marginLeft: 'auto', opacity: 0.3 }}>sat-viz</span>
    </div>
  );
}
