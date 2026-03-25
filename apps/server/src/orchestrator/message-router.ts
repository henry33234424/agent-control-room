import type { AgentKind, MentionTarget } from '@control-room/shared-types';

/**
 * Parse @Claude / @Codex / @both mentions from message content.
 * Returns the explicit mentionTarget if provided, otherwise tries to parse from content.
 */
export function parseMention(
  content: string,
  explicitTarget?: MentionTarget,
): { target: MentionTarget; cleanContent: string } {
  if (explicitTarget) {
    return { target: explicitTarget, cleanContent: content };
  }

  const lower = content.toLowerCase();

  if (lower.startsWith('@both ') || lower.includes(' @both ')) {
    return { target: 'both', cleanContent: content.replace(/@both\s*/gi, '').trim() };
  }
  if (lower.startsWith('@claude ') || lower.includes(' @claude ')) {
    return { target: 'claude', cleanContent: content.replace(/@claude\s*/gi, '').trim() };
  }
  if (lower.startsWith('@codex ') || lower.includes(' @codex ')) {
    return { target: 'codex', cleanContent: content.replace(/@codex\s*/gi, '').trim() };
  }

  // Default to claude if no mention found
  return { target: 'claude', cleanContent: content };
}

/**
 * Get the list of agents to dispatch to.
 */
export function getTargetAgents(target: MentionTarget): AgentKind[] {
  if (target === 'both') return ['claude', 'codex'];
  return [target];
}
