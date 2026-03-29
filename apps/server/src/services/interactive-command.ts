import type { AgentKind } from '@control-room/shared-types';
import { config } from '../config.js';

export function buildInteractiveCommand(input: {
  agent: AgentKind;
  cwd: string;
  vendorSessionId?: string;
}): { command: string; args: string[] } {
  if (input.agent === 'claude') {
    const args: string[] = [];
    if (config.claudeModel) args.push('--model', config.claudeModel);
    if (input.vendorSessionId) args.push('-r', input.vendorSessionId);
    return { command: 'claude', args };
  }

  const args = ['-C', input.cwd];
  if (config.codexModel) args.push('-m', config.codexModel);
  if (input.vendorSessionId) {
    args.push('resume', input.vendorSessionId);
  }
  return { command: 'codex', args };
}
