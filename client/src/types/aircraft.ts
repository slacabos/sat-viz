export interface AircraftState {
  icao24: string;
  callsign: string | null;
  originCountry: string;
  lon: number | null;
  lat: number | null;
  baroAltitude: number | null;
  onGround: boolean;
  velocity: number | null;
  trueTrack: number | null;
  verticalRate: number | null;
  geoAltitude: number | null;
}

export interface FlightInfo {
  departureAirport: string | null;
  arrivalAirport: string | null;
}
