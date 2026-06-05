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
}
