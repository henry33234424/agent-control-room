import { execSync } from 'node:child_process';
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
  execSync(`git worktree add -b "${branch}" "${path}" "${input.baseBranch}"`, {
    cwd: input.repoPath,
    stdio: 'pipe',
  });

  return { path, branch };
}

export function removeWorktree(repoPath: string, wtPath: string): void {
  try {
    execSync(`git worktree remove "${wtPath}" --force`, {
      cwd: repoPath,
      stdio: 'pipe',
    });
  } catch {
    // Worktree may already be removed
  }
}

export function listWorktrees(repoPath: string): WorktreeInfo[] {
  const output = execSync('git worktree list --porcelain', {
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
