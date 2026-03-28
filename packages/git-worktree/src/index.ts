import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface WorktreeInfo {
  path: string;
  branch: string;
}

export function worktreePath(baseDir: string, agent: string, sessionKey: string): string {
  return join(baseDir, 'worktrees', agent, sessionKey);
}

export function branchName(agent: string, sessionKey: string): string {
  return `agent/${agent}/${sessionKey}`;
}

export function isGitRepository(repoPath: string): boolean {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: repoPath,
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}

export function initRepository(input: {
  repoPath: string;
  baseBranch: string;
}): void {
  execFileSync('git', ['init'], {
    cwd: input.repoPath,
    stdio: 'pipe',
  });

  execFileSync('git', ['symbolic-ref', 'HEAD', `refs/heads/${input.baseBranch}`], {
    cwd: input.repoPath,
    stdio: 'pipe',
  });

  execFileSync('git', ['add', '-A'], {
    cwd: input.repoPath,
    stdio: 'pipe',
  });

  execFileSync(
    'git',
    [
      '-c',
      'user.name=Control Room',
      '-c',
      'user.email=control-room@local',
      'commit',
      '--allow-empty',
      '-m',
      'Initialize Control Room repository',
    ],
    {
      cwd: input.repoPath,
      stdio: 'pipe',
    },
  );
}

export function ensureWorktree(input: {
  repoPath: string;
  baseDir: string;
  agent: string;
  sessionKey: string;
  baseBranch: string;
}): WorktreeInfo {
  const path = worktreePath(input.baseDir, input.agent, input.sessionKey);
  const branch = branchName(input.agent, input.sessionKey);

  if (existsSync(path)) {
    return { path, branch };
  }

  // Create the worktree with a new branch from baseBranch
  execFileSync('git', ['worktree', 'add', '-b', branch, path, input.baseBranch], {
    cwd: input.repoPath,
    stdio: 'pipe',
  });

  return { path, branch };
}

export function removeWorktree(repoPath: string, wtPath: string): void {
  try {
    execFileSync('git', ['worktree', 'remove', wtPath, '--force'], {
      cwd: repoPath,
      stdio: 'pipe',
    });
  } catch {
    // Worktree may already be removed
  }
}

export function listWorktrees(repoPath: string): WorktreeInfo[] {
  const output = execFileSync('git', ['worktree', 'list', '--porcelain'], {
    cwd: repoPath,
    encoding: 'utf-8',
  });

  const worktrees: WorktreeInfo[] = [];
  let currentPath = '';

  for (const line of output.split('\n')) {
    if (line.startsWith('worktree ')) {
      currentPath = line.slice('worktree '.length);
    } else if (line.startsWith('branch ') && currentPath) {
      worktrees.push({ path: currentPath, branch: line.slice('branch '.length) });
      currentPath = '';
    }
  }

  return worktrees;
}
