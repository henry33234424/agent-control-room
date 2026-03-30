import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(import.meta.dirname, '../../../.env') });
import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { config, corsMethods } from './config.js';
import { prisma } from './db.js';
import { roomRoutes } from './routes/rooms.js';
import { sessionRoutes } from './routes/sessions.js';
import { messageRoutes } from './routes/messages.js';
import { pinRoutes } from './routes/pins.js';
import { excerptRoutes } from './routes/excerpts.js';
import { registerWebSocket } from './ws/handler.js';
import { ptyManager } from './ws/pty-manager.js';

async function main() {
  const app = Fastify({
    logger: {
      transport: {
        target: 'pino-pretty',
        options: { colorize: true },
      },
    },
  });

  // Plugins
  await app.register(websocket);
  await app.register(cors, {
    origin: true, // Allow all origins (WS + HTTP) — safe for local-first single-user app
    methods: corsMethods,
  });

  // Routes
  await app.register(roomRoutes);
  await app.register(sessionRoutes);
  await app.register(messageRoutes);
  await app.register(pinRoutes);
  await app.register(excerptRoutes);

  // WebSocket
  await registerWebSocket(app);

  // Health check
  app.get('/api/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  // Graceful shutdown
  const shutdown = async () => {
    app.log.info('Shutting down...');
    await ptyManager.prepareForShutdown();
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Start
  await app.listen({ port: config.port, host: config.host });
  app.log.info(`Control Room server running on http://${config.host}:${config.port}`);
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
