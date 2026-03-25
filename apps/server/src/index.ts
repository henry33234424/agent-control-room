import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { config } from './config.js';
import { prisma } from './db.js';
import { roomRoutes } from './routes/rooms.js';
import { sessionRoutes } from './routes/sessions.js';
import { messageRoutes } from './routes/messages.js';
import { runRoutes } from './routes/runs.js';
import { approvalRoutes } from './routes/approvals.js';
import { pinRoutes } from './routes/pins.js';
import { handoffRoutes } from './routes/handoffs.js';
import { reviewRoutes } from './routes/reviews.js';
import { registerWebSocket } from './ws/handler.js';
import { orchestrator } from './orchestrator/room-orchestrator.js';
import { ClaudeAdapter } from './adapters/claude/claude-adapter.js';
import { CodexAdapter } from './adapters/codex/codex-adapter.js';

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
  await app.register(cors, { origin: config.corsOrigin });
  await app.register(websocket);

  // Routes
  await app.register(roomRoutes);
  await app.register(sessionRoutes);
  await app.register(messageRoutes);
  await app.register(runRoutes);
  await app.register(approvalRoutes);
  await app.register(pinRoutes);
  await app.register(handoffRoutes);
  await app.register(reviewRoutes);

  // WebSocket
  await registerWebSocket(app);

  // Register agent adapters
  orchestrator.registerDriver('claude', new ClaudeAdapter());
  orchestrator.registerDriver('codex', new CodexAdapter());

  // Health check
  app.get('/api/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  // Graceful shutdown
  const shutdown = async () => {
    app.log.info('Shutting down...');
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
