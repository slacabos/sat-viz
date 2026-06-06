# sat-viz

Real-time 3D globe tracking satellites, aircraft, and marine vessels using free public data sources.

![Stack](https://img.shields.io/badge/React-18-blue) ![Stack](https://img.shields.io/badge/Three.js-globe-green) ![Stack](https://img.shields.io/badge/TypeScript-strict-blue)

## Data sources

| Layer | Source | Update frequency |
|-------|--------|-----------------|
| 🛰 Satellites | [CelesTrak](https://celestrak.org) TLE + `satellite.js` propagation | Positions every 10s, TLEs every 2h |
| ✈ Aircraft | [OpenSky Network](https://opensky-network.org) via local proxy | Every 60s |
| 🚢 Vessels | [AISStream](https://aisstream.io) WebSocket | Real-time stream |

## Prerequisites

- Node.js 18+
- Docker Compose for local Valkey
- A free AISStream API key (sign in at [aisstream.io](https://aisstream.io) with GitHub)

## Setup

```bash
git clone <repo>
cd sat-viz
npm install

cp .env.example .env
# Edit .env and set AISSTREAM_KEY

docker compose up -d valkey
```

## Run

```bash
npm run dev
```

Opens the frontend at **http://localhost:5173**. The Express proxy runs on **http://localhost:3001**.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `AISSTREAM_KEY` | Yes | Server-only AISStream API key for vessel tracking |
| `VALKEY_URL` | Yes | Valkey connection URL for vessel cache, pub/sub, and relay leadership |
| `PORT` | No | Express server port (default: 3001) |
| `CLIENT_ORIGIN` | No | CORS origin for the client (default: `http://localhost:5173`) |
| `OPENSKY_CLIENT_ID` | No | OpenSky OAuth2 client ID — raises daily limit from 400 → 4000 credits |
| `OPENSKY_CLIENT_SECRET` | No | OpenSky OAuth2 client secret |

## Architecture

```
CelesTrak TLE JSON
  └─> Web Worker (satellite.js) — off main thread
        └─> positions every 10s → Zustand store → Globe

OpenSky Network (no CORS)
  └─> Express proxy (/api/aircraft) — 12s server-side cache
        └─> client polls every 60s → store → Globe

AISStream WebSocket
  └─> Express SSE relay (/api/vessels/stream) — Valkey cache + leadership
        └─> store → Globe
```

## Local Valkey

The server requires Valkey before it will start:

```bash
docker compose up -d valkey
```

Stop the local Valkey container when you are done:

```bash
docker compose down
```

## UI

- **Layer toggles** (top-left) — show/hide satellites, aircraft, vessels
- **Click any object** — opens a detail panel on the right
- **Status bar** (bottom) — live counts and last-update timestamps

## Satellite colours

| Colour | Orbit |
|--------|-------|
| Cyan | LEO (< 2 000 km) |
| Indigo | MEO (2 000 – 35 000 km) |
| Gold | GEO (> 35 000 km) |

## Production build

```bash
npm run build
npm start        # serves the Express proxy; point a static host at client/dist
```
