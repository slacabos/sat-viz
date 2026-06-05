export interface VesselPosition {
  mmsi: string;
  shipName: string | null;
  lat: number;
  lon: number;
  sog: number | null;
  cog: number | null;
  heading: number | null;
  shipType: number | null;
  lastUpdate: number;
}
