export interface TLERecord {
  name: string;
  line1: string;
  line2: string;
}

export interface SatellitePosition {
  id: number;
  name: string;
  lat: number;
  lng: number;
  altKm: number;
  inclination: number;
  periodMin: number;
  apogeeKm: number;
  perigeeKm: number;
  targetLat?: number;
  targetLng?: number;
  targetAltKm?: number;
  sampleTimeMs?: number;
  targetTimeMs?: number;
}
