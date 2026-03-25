import { PrismaClient } from '@prisma/client';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';

const TEST_DB_DIR = resolve(import.meta.dirname, '../.test-dbs');

// Create a fresh Prisma client pointing at a temp SQLite file per test suite
export function createTestPrisma(): PrismaClient {
  mkdirSync(TEST_DB_DIR, { recursive: true });
  const dbPath = resolve(TEST_DB_DIR, `test-${randomUUID()}.db`);
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

// Cleanup test DBs after all tests
afterAll(() => {
  try {
    rmSync(TEST_DB_DIR, { recursive: true, force: true });
  } catch {
    // ignore
  }
});
