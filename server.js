import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { catalogRouter } from './routes/catalog.js';
import { searchRouter } from './routes/search.js';
import { titleRouter } from './routes/titles.js';

const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') ?? '*' }));
app.use(express.json({ limit: '32kb' }));
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
app.use('/api/catalog', catalogRouter);
app.use('/api/search', searchRouter);
app.use('/api/titles', titleRouter);
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status ?? 500).json({ error: err.status ? err.message : 'Error interno' });
});
const port = Number(process.env.PORT ?? 3000);
app.listen(port, '0.0.0.0', () => console.log(`API listening on ${port}`));