import { PrismaClient } from '@prisma/client';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve, join } from 'node:path';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const TEST_DB_ROOT = mkdtempSync(join(tmpdir(), 'control-room-tests-'));

// Create a fresh Prisma client pointing at a temp SQLite file per test suite
export function createTestPrisma(): PrismaClient {
  mkdirSync(TEST_DB_ROOT, { recursive: true });
  const suiteDir = mkdtempSync(join(TEST_DB_ROOT, 'suite-'));
  const dbPath = resolve(suiteDir, `test-${randomUUID()}.db`);
  const url = `file:${dbPath}`;

  // Apply migrations
  execSync(`npx prisma migrate deploy --schema ../../prisma/schema.prisma`, {
    cwd: resolve(import.meta.dirname, '..'),
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });

  const prisma = new PrismaClient({ datasources: { db: { url } } });
  return prisma;
}
