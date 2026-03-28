import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initRepository, isGitRepository } from '@control-room/git-worktree';

describe('git repository initialization', () => {
  it('initializes a non-git folder into a usable repository with an initial commit', () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'control-room-git-init-'));

    try {
      writeFileSync(join(repoPath, 'README.md'), '# Test Repo\n');

      expect(isGitRepository(repoPath)).toBe(false);

      initRepository({
        repoPath,
        baseBranch: 'main',
      });

      expect(isGitRepository(repoPath)).toBe(true);
      expect(
        execFileSync('git', ['branch', '--show-current'], {
          cwd: repoPath,
          encoding: 'utf-8',
        }).trim(),
      ).toBe('main');
      expect(
        execFileSync('git', ['rev-list', '--count', 'HEAD'], {
          cwd: repoPath,
          encoding: 'utf-8',
        }).trim(),
      ).toBe('1');
      expect(
        execFileSync('git', ['ls-files'], {
          cwd: repoPath,
          encoding: 'utf-8',
        }),
      ).toContain('README.md');
    } finally {
      rmSync(repoPath, { recursive: true, force: true });
    }
  });
});
