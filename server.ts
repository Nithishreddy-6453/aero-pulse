import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  apiErrorHandler,
  apiNotFoundHandler,
  geminiRateLimiter,
  payloadTooLargeHandler,
  securityHeadersMiddleware,
} from './server/middleware.ts';
import { registerApiRoutes } from './server/routes.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT) || 3000;

async function startServer() {
  const app = express();
  app.disable('x-powered-by');

  app.use(securityHeadersMiddleware);
  app.use(express.json({ limit: '5mb' }));
  app.use(payloadTooLargeHandler);

  // Apply 20 req/min per-IP rate limiting on all AI-backed API endpoints
  app.use('/api/today/advisory', geminiRateLimiter);
  app.use('/api/today/ask', geminiRateLimiter);
  app.use('/api/room-audit/analyze', geminiRateLimiter);
  app.use('/api/copilot/chat', geminiRateLimiter);
  app.use('/api/commute/analyze', geminiRateLimiter);

  registerApiRoutes(app);

  // Guarantee unmatched /api/* routes and API errors always return JSON (never HTML)
  app.all('/api/*', apiNotFoundHandler);
  app.use('/api', apiErrorHandler);

  // Mount Vite dev middleware in dev, or serve static dist in production
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    process.stdout.write(`AeroPulse server running at http://0.0.0.0:${PORT}\n`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start AeroPulse server:', err);
  process.exit(1);
});
