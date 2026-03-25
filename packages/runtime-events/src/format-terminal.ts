import type { RuntimeEvent } from '@control-room/shared-types';

/**
 * ANSI color codes for xterm.js rendering.
 */
const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  white: '\x1b[37m',
  brightWhite: '\x1b[97m',
  brightYellow: '\x1b[93m',
  gray: '\x1b[90m',
};

/**
 * Format a RuntimeEvent into ANSI-colored text for xterm.js display.
 */
export function formatForTerminal(event: RuntimeEvent): string {
  const time = formatTime(event.ts);

  switch (event.kind) {
    case 'run.status':
    case 'run.started':
      return `${ANSI.dim}${time}${ANSI.reset} ${ANSI.cyan}${ANSI.bold}▸ ${event.title ?? event.kind}${ANSI.reset}\n`;

    case 'run.completed':
      return `${ANSI.dim}${time}${ANSI.reset} ${ANSI.cyan}${ANSI.bold}✓ ${event.title ?? 'Completed'}${ANSI.reset}\n`;

    case 'run.failed':
      return `${ANSI.dim}${time}${ANSI.reset} ${ANSI.red}${ANSI.bold}✗ ${event.title ?? 'Failed'}${ANSI.reset}${event.text ? `\n  ${ANSI.red}${event.text}${ANSI.reset}` : ''}\n`;

    case 'tool.started':
      return `${ANSI.dim}${time}${ANSI.reset} ${ANSI.yellow}⚙ ${event.title}${ANSI.reset}${event.text ? ` ${ANSI.dim}${event.text}${ANSI.reset}` : ''}\n`;

    case 'tool.completed':
      return `${ANSI.dim}${time}${ANSI.reset} ${ANSI.yellow}⚙ ${event.title} ${ANSI.green}done${ANSI.reset}\n`;

    case 'tool.failed':
      return `${ANSI.dim}${time}${ANSI.reset} ${ANSI.yellow}⚙ ${event.title} ${ANSI.red}failed${ANSI.reset}${event.text ? `\n  ${ANSI.red}${event.text}${ANSI.reset}` : ''}\n`;

    case 'command.stdout':
      return `${event.text ?? ''}\n`;

    case 'command.stderr':
      return `${ANSI.red}${event.text ?? ''}${ANSI.reset}\n`;

    case 'message.delta':
      return `${ANSI.green}${event.text ?? ''}${ANSI.reset}`;

    case 'message.final':
      return `${ANSI.brightWhite}${event.text ?? ''}${ANSI.reset}\n`;

    case 'approval.requested':
      return `\n${ANSI.brightYellow}${ANSI.bold}⚠ APPROVAL NEEDED: ${event.title}${ANSI.reset}\n${ANSI.brightYellow}  Approve or deny in the UI${ANSI.reset}\n\n`;

    case 'approval.resolved':
      return `${ANSI.dim}${time}${ANSI.reset} ${ANSI.cyan}✓ Approval resolved: ${event.title}${ANSI.reset}\n`;

    case 'diff.ready':
      return `${ANSI.dim}${time}${ANSI.reset} ${ANSI.green}${ANSI.bold}📄 Diff ready${ANSI.reset} ${event.text ?? ''}\n`;

    case 'system.log':
      return `${ANSI.gray}${time} ${event.title ?? ''}${event.text ? `: ${event.text}` : ''}${ANSI.reset}\n`;

    default:
      return `${ANSI.dim}${time} [${event.kind}] ${event.text ?? ''}${ANSI.reset}\n`;
  }
}

function formatTime(ts: string): string {
  try {
    return new Date(ts).toLocaleTimeString('en-US', { hour12: false });
  } catch {
    return ts;
  }
}
