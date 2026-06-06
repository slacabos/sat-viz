import { useAppStore } from '../store/useAppStore';

export function LayerControls() {
  const layers = useAppStore((s) => s.layers);
  const toggleLayer = useAppStore((s) => s.toggleLayer);
  const satelliteCount = useAppStore((s) => s.satellites.length);
  const airborneCount = useAppStore((s) => s.aircraft.filter((a) => !a.onGround).length);
  const vesselCount = useAppStore((s) => s.vessels.length);
  const buttons = [
    {
      key: 'satellites' as const,
      label: 'Satellites',
      count: satelliteCount,
      color: '#22d3ee',
      icon: '🛰',
    },
    {
      key: 'aircraft' as const,
      label: 'Aircraft',
      count: airborneCount,
      color: '#f59e0b',
      icon: '✈',
    },
    {
      key: 'vessels' as const,
      label: 'Vessels',
      count: vesselCount,
      color: '#10b981',
      icon: '🚢',
    },
  ];

  return (
    <div
      style={{
        position: 'fixed',
        top: 20,
        left: 20,
        zIndex: 100,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        background: 'rgba(10,10,20,0.85)',
        backdropFilter: 'blur(8px)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 12,
        padding: 16,
      }}
    >
      <div
        style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, marginBottom: 4, letterSpacing: 1 }}
      >
        LAYERS
      </div>
      {buttons.map((btn) => (
        <button
          key={btn.key}
          onClick={() => toggleLayer(btn.key)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 12px',
            borderRadius: 8,
            border: `1px solid ${layers[btn.key] ? btn.color + '66' : 'rgba(255,255,255,0.1)'}`,
            background: layers[btn.key] ? btn.color + '22' : 'transparent',
            color: layers[btn.key] ? btn.color : 'rgba(255,255,255,0.4)',
            cursor: 'pointer',
            fontSize: 13,
            transition: 'all 0.15s',
            minWidth: 160,
          }}
        >
          <span style={{ fontSize: 16 }}>{btn.icon}</span>
          <span style={{ flex: 1, textAlign: 'left', fontWeight: 500 }}>{btn.label}</span>
          <span
            style={{
              fontSize: 11,
              opacity: 0.7,
              background: 'rgba(0,0,0,0.3)',
              borderRadius: 4,
              padding: '2px 6px',
            }}
          >
            {btn.count.toLocaleString()}
          </span>
        </button>
      ))}
    </div>
  );
}

export function RotationControl() {
  const autoRotate = useAppStore((s) => s.autoRotate);
  const setAutoRotate = useAppStore((s) => s.setAutoRotate);
  const rotateColor = '#a78bfa';

  return (
    <button
      onClick={() => setAutoRotate(!autoRotate)}
      title={autoRotate ? 'Stop rotation' : 'Resume rotation'}
      style={{
        position: 'fixed',
        bottom: 52,
        right: 20,
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 14px',
        borderRadius: 8,
        border: `1px solid ${autoRotate ? rotateColor + '66' : 'rgba(255,255,255,0.1)'}`,
        background: autoRotate ? rotateColor + '22' : 'rgba(10,10,20,0.85)',
        backdropFilter: 'blur(8px)',
        color: autoRotate ? rotateColor : 'rgba(255,255,255,0.4)',
        cursor: 'pointer',
        fontSize: 13,
        fontFamily: 'inherit',
        transition: 'all 0.15s',
      }}
    >
      <span style={{ fontSize: 16 }}>{autoRotate ? '⟳' : '⏸'}</span>
      <span style={{ fontWeight: 500 }}>Rotation</span>
    </button>
  );
}
