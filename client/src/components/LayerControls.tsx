import { useAppStore } from '../store/useAppStore';

export function LayerControls() {
  const layers = useAppStore((s) => s.layers);
  const toggleLayer = useAppStore((s) => s.toggleLayer);
  const satelliteOrbits = useAppStore((s) => s.satelliteOrbits);
  const toggleSatelliteOrbit = useAppStore((s) => s.toggleSatelliteOrbit);
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
  const orbitFilters = [
    { key: 'LEO' as const, label: 'LEO', color: '#22d3ee' },
    { key: 'MEO' as const, label: 'MEO', color: '#818cf8' },
    { key: 'GEO' as const, label: 'GEO', color: '#fbbf24' },
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
      <div
        style={{
          borderTop: '1px solid rgba(255,255,255,0.08)',
          marginTop: 4,
          paddingTop: 12,
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 6,
        }}
      >
        {orbitFilters.map((orbit) => {
          const active = satelliteOrbits[orbit.key];
          return (
            <button
              key={orbit.key}
              onClick={() => toggleSatelliteOrbit(orbit.key)}
              title={`${orbit.label} satellites`}
              style={{
                height: 28,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 5,
                borderRadius: 6,
                border: `1px solid ${active ? orbit.color + '88' : 'rgba(255,255,255,0.1)'}`,
                background: active ? orbit.color + '1f' : 'rgba(255,255,255,0.03)',
                color: active ? 'rgba(255,255,255,0.88)' : 'rgba(255,255,255,0.34)',
                cursor: 'pointer',
                fontSize: 11,
                fontFamily: 'inherit',
                fontWeight: 600,
              }}
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: 999,
                  background: orbit.color,
                  opacity: active ? 1 : 0.35,
                  boxShadow: active ? `0 0 10px ${orbit.color}` : 'none',
                }}
              />
              {orbit.label}
            </button>
          );
        })}
      </div>
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
