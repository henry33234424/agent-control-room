export const config = {
  port: parseInt(process.env.PORT ?? '3002', 10),
  host: process.env.HOST ?? '0.0.0.0',
  databaseUrl: process.env.DATABASE_URL ?? 'file:../../data/room.db',
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:3000',
  approvalTimeoutMs: parseInt(process.env.APPROVAL_TIMEOUT_MS ?? '600000', 10), // 10 min
};
