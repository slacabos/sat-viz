export interface TLERecord {
  OBJECT_NAME: string;
  NORAD_CAT_ID: number;
  INCLINATION: number;
  MEAN_MOTION: number;
  TLE_LINE1: string;
  TLE_LINE2: string;
}

export interface SatellitePosition {
  id: number;
  name: string;
  lat: number;
  lng: number;
  altKm: number;
  inclination: number;
}
