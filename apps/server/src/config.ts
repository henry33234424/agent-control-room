export const corsMethods: string[] = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];

export const config = {
  port: parseInt(process.env.PORT ?? '3002', 10),
  host: process.env.HOST ?? '::',
  databaseUrl: process.env.DATABASE_URL ?? 'file:../../data/room.db',
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:3005',
  approvalTimeoutMs: parseInt(process.env.APPROVAL_TIMEOUT_MS ?? '600000', 10), // 10 min
};
