import { useAppStore } from '../store/useAppStore';
import type { SatellitePosition } from '../types/satellite';
import type { AircraftState } from '../types/aircraft';
import type { VesselPosition } from '../types/vessel';

const SHIP_TYPES: Record<number, string> = {
  20: 'Wing in Ground',
  21: 'WIG Hazmat',
  30: 'Fishing',
  31: 'Towing',
  32: 'Towing Large',
  33: 'Dredging',
  34: 'Diving Ops',
  35: 'Military',
  36: 'Sailing',
  37: 'Pleasure Craft',
  40: 'High Speed',
  50: 'Pilot',
  51: 'SAR',
  52: 'Tug',
  53: 'Port Tender',
  60: 'Passenger',
  70: 'Cargo',
  80: 'Tanker',
  90: 'Other',
};

function getShipType(code: number | null): string {
  if (code == null) return 'Unknown';
  const base = Math.floor(code / 10) * 10;
  return SHIP_TYPES[code] ?? SHIP_TYPES[base] ?? `Type ${code}`;
}

function Row({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (value == null || value === '') return null;
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        padding: '5px 0',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12 }}>{label}</span>
      <span style={{ color: 'rgba(255,255,255,0.9)', fontSize: 12, fontWeight: 500 }}>{value}</span>
    </div>
  );
}

function getConstellation(name: string): string {
  const n = name.toUpperCase();
  if (n.startsWith('STARLINK')) return 'Starlink';
  if (n.startsWith('ONEWEB')) return 'OneWeb';
  if (n.startsWith('IRIDIUM')) return 'Iridium';
  if (n.startsWith('GPS')) return 'GPS';
  if (n.startsWith('GLONASS')) return 'GLONASS';
  if (n.startsWith('BEIDOU') || n.startsWith('BDS')) return 'BeiDou';
  if (n.startsWith('GALILEO')) return 'Galileo';
  if (n.includes('ISS') || n.includes('ZARYA') || n.includes('ZVEZDA')) return 'ISS';
  if (n.startsWith('NOAA')) return 'NOAA';
  if (n.startsWith('GOES')) return 'GOES';
  if (n.startsWith('METEOSAT')) return 'Meteosat';
  if (n.startsWith('LANDSAT')) return 'Landsat';
  if (n.startsWith('SENTINEL')) return 'Sentinel';
  if (n.startsWith('TERRA') || n.startsWith('AQUA')) return 'NASA EOS';
  if (n.startsWith('HUBBLE') || n.includes('HST')) return 'Hubble';
  return 'Other';
}

function SatPanel({ data }: { data: SatellitePosition }) {
  const orbitClass = data.altKm < 2000 ? 'LEO' : data.altKm < 35000 ? 'MEO' : 'GEO';
  return (
    <>
      <Row label="NORAD ID" value={data.id} />
      <Row label="Constellation" value={getConstellation(data.name)} />
      <Row label="Orbit" value={orbitClass} />
      <Row label="Altitude" value={`${Math.round(data.altKm).toLocaleString()} km`} />
      <Row label="Apogee" value={`${Math.round(data.apogeeKm).toLocaleString()} km`} />
      <Row label="Perigee" value={`${Math.round(data.perigeeKm).toLocaleString()} km`} />
      <Row label="Inclination" value={`${data.inclination.toFixed(1)}°`} />
      <Row label="Period" value={`${data.periodMin.toFixed(1)} min`} />
    </>
  );
}

function AircraftPanel({ data }: { data: AircraftState }) {
  const altFt =
    data.baroAltitude != null ? Math.round(data.baroAltitude * 3.28084).toLocaleString() : null;
  const speedKts =
    data.velocity != null ? Math.round(data.velocity * 1.944).toLocaleString() : null;
  return (
    <>
      <Row label="ICAO24" value={data.icao24.toUpperCase()} />
      <Row label="Country" value={data.originCountry} />
      <Row label="Altitude" value={altFt ? `${altFt} ft` : null} />
      <Row label="Speed" value={speedKts ? `${speedKts} kts` : null} />
      <Row
        label="Heading"
        value={data.trueTrack != null ? `${Math.round(data.trueTrack)}°` : null}
      />
      <Row
        label="Vert. Rate"
        value={
          data.verticalRate != null
            ? `${data.verticalRate > 0 ? '+' : ''}${Math.round(data.verticalRate)} m/s`
            : null
        }
      />
    </>
  );
}

function VesselPanel({ data }: { data: VesselPosition }) {
  return (
    <>
      <Row label="MMSI" value={data.mmsi} />
      <Row label="Type" value={getShipType(data.shipType)} />
      <Row label="Speed" value={data.sog != null ? `${data.sog.toFixed(1)} kts` : null} />
      <Row label="Course" value={data.cog != null ? `${Math.round(data.cog)}°` : null} />
      <Row label="Heading" value={data.heading != null ? `${data.heading}°` : null} />
      <Row label="Position" value={`${data.lat.toFixed(4)}, ${data.lon.toFixed(4)}`} />
    </>
  );
}

export function InfoPanel() {
  const selected = useAppStore((s) => s.selectedObject);
  const setSelectedObject = useAppStore((s) => s.setSelectedObject);

  if (!selected) return null;

  const title =
    selected.type === 'satellite'
      ? selected.data.name
      : selected.type === 'aircraft'
        ? (selected.data.callsign ?? selected.data.icao24.toUpperCase())
        : (selected.data.shipName ?? selected.data.mmsi);

  const typeLabel =
    selected.type === 'satellite'
      ? '🛰 Satellite'
      : selected.type === 'aircraft'
        ? '✈ Aircraft'
        : '🚢 Vessel';

  const accentColor =
    selected.type === 'satellite'
      ? '#22d3ee'
      : selected.type === 'aircraft'
        ? '#f59e0b'
        : '#10b981';

  return (
    <div
      style={{
        position: 'fixed',
        right: 0,
        top: 0,
        height: '100vh',
        width: 300,
        background: 'rgba(8,8,18,0.92)',
        backdropFilter: 'blur(12px)',
        borderLeft: `1px solid ${accentColor}33`,
        padding: 20,
        zIndex: 100,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        overflowY: 'auto',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ color: accentColor, fontSize: 11, letterSpacing: 1, marginBottom: 4 }}>
            {typeLabel}
          </div>
          <div style={{ color: '#fff', fontSize: 16, fontWeight: 600, wordBreak: 'break-all' }}>
            {title}
          </div>
        </div>
        <button
          onClick={() => setSelectedObject(null)}
          style={{
            background: 'rgba(255,255,255,0.1)',
            border: 'none',
            borderRadius: 6,
            color: '#fff',
            cursor: 'pointer',
            fontSize: 16,
            width: 28,
            height: 28,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          ×
        </button>
      </div>

      <div>
        {selected.type === 'satellite' && <SatPanel data={selected.data} />}
        {selected.type === 'aircraft' && <AircraftPanel data={selected.data} />}
        {selected.type === 'vessel' && <VesselPanel data={selected.data} />}
      </div>
    </div>
  );
}
