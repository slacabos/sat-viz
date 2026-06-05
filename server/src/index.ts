import path from 'node:path';
import { config } from 'dotenv';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { aircraftRouter } from './routes/aircraft.js';
import { vesselsRouter } from './routes/vessels.js';

config({ path: path.resolve(__dirname, '../../.env') });

const app = express();
const PORT = process.env.PORT || 3001;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

app.use(helmet());
app.use(cors({ origin: CLIENT_ORIGIN }));
app.use(rateLimit({ windowMs: 60_000, max: 120 }));
app.use(express.json());

app.use('/api/aircraft', aircraftRouter);
app.use('/api/vessels', vesselsRouter);

app.get('/health', (_req, res) => res.json({ ok: true }));

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
}

export { app };
