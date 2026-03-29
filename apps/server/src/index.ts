import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { config, corsMethods } from './config.js';
import { prisma } from './db.js';
import { roomRoutes } from './routes/rooms.js';
import { sessionRoutes } from './routes/sessions.js';
import { messageRoutes } from './routes/messages.js';
import { runRoutes } from './routes/runs.js';
import { approvalRoutes } from './routes/approvals.js';
import { pinRoutes } from './routes/pins.js';
import { reviewRoutes } from './routes/reviews.js';
import { excerptRoutes } from './routes/excerpts.js';
import { registerWebSocket } from './ws/handler.js';
import { ptyManager } from './ws/pty-manager.js';
import { orchestrator } from './orchestrator/room-orchestrator.js';
import { ClaudeCLIAdapter } from './adapters/cli/claude-cli-adapter.js';
import { CodexCLIAdapter } from './adapters/cli/codex-cli-adapter.js';

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
  await app.register(runRoutes);
  await app.register(approvalRoutes);
  await app.register(pinRoutes);
  await app.register(reviewRoutes);
  await app.register(excerptRoutes);

  // WebSocket
  await registerWebSocket(app);

  // Register agent adapters (CLI mode by default, SDK mode via ADAPTER_MODE=sdk)
  if (config.adapterMode === 'sdk') {
    // Dynamic import to avoid loading SDK deps when not needed
    const { ClaudeAdapter } = await import('./adapters/claude/claude-sdk-adapter.js');
    const { CodexAdapter } = await import('./adapters/codex/codex-rpc-adapter.js');
    orchestrator.registerDriver('claude', new ClaudeAdapter());
    orchestrator.registerDriver('codex', new CodexAdapter());
    app.log.info('Using SDK/RPC adapters');
  } else {
    orchestrator.registerDriver('claude', new ClaudeCLIAdapter());
    orchestrator.registerDriver('codex', new CodexCLIAdapter());
    app.log.info('Using CLI adapters');
  }

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
