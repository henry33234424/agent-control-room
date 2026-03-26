export const corsMethods: string[] = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];

export const config = {
  port: parseInt(process.env.PORT ?? '3002', 10),
  host: process.env.HOST ?? '::',
  databaseUrl: process.env.DATABASE_URL ?? 'file:../../data/room.db',
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:3005',
  approvalTimeoutMs: parseInt(process.env.APPROVAL_TIMEOUT_MS ?? '600000', 10), // 10 min
  adapterMode: (process.env.ADAPTER_MODE ?? 'cli') as 'cli' | 'sdk',
  claudeModel: process.env.CLAUDE_MODEL ?? '',   // e.g. 'sonnet', 'opus', 'haiku'
  codexModel: process.env.CODEX_MODEL ?? '',      // e.g. 'o3', 'o4-mini'
};
