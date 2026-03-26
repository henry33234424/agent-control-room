import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@control-room/runtime-events': path.resolve(
        __dirname,
        '../../packages/runtime-events/src/index.ts',
      ),
      '@control-room/shared-types': path.resolve(
        __dirname,
        '../../packages/shared-types/src/index.ts',
      ),
      '@control-room/git-worktree': path.resolve(
        __dirname,
        '../../packages/git-worktree/src/index.ts',
      ),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 15000,
  },
});
