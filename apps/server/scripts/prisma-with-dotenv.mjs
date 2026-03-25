import { config as loadEnv } from 'dotenv';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '../../..');

loadEnv({ path: resolve(repoRoot, '.env'), quiet: true });

const args = process.argv.slice(2);
const result = spawnSync('prisma', args, {
  cwd: resolve(repoRoot, 'apps/server'),
  env: process.env,
  stdio: 'inherit',
  shell: true,
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 0);
