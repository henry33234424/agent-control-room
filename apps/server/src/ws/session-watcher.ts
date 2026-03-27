import { watch, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { AgentKind } from '@control-room/shared-types';
import { messageService } from '../services/message-service.js';

/**
 * Watches CLI session JSONL files for new messages.
 *
 * Claude: ~/.claude/projects/<cwd-encoded>/<session-uuid>.jsonl
 * Codex:  ~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl
 */
export class SessionWatcher {
  private watcher: ReturnType<typeof watch> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private bytesRead = 0;
  private filePath: string | null = null;
  private roomId: string;
  private sessionId: string;
  private agent: AgentKind;
  private seenContent = new Set<string>(); // dedup user messages from chat API
  private stopped = false;

  constructor(input: { roomId: string; sessionId: string; agent: AgentKind }) {
    this.roomId = input.roomId;
    this.sessionId = input.sessionId;
    this.agent = input.agent;
  }

  /**
   * Register a user message content that was already created via chat API.
   * SessionWatcher will skip this content to avoid duplicates.
   */
  markSent(content: string): void {
    this.seenContent.add(content.trim());
    // Keep set bounded
    if (this.seenContent.size > 50) {
      const first = this.seenContent.values().next().value;
      if (first) this.seenContent.delete(first);
    }
  }

  start(cwd: string): void {
    this.stopped = false;

    // Poll for the session file to appear
    this.pollTimer = setInterval(() => {
      if (this.stopped) return;

      const file = this.findSessionFile(cwd);
      if (file) {
        this.filePath = file;
        this.startWatching();
        if (this.pollTimer) {
          clearInterval(this.pollTimer);
          this.pollTimer = null;
        }
      }
    }, 500);
  }

  stop(): void {
    this.stopped = true;
    if (this.watcher) { this.watcher.close(); this.watcher = null; }
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
  }

  private startWatching(): void {
    if (!this.filePath || !existsSync(this.filePath)) return;

    // Skip existing content
    this.bytesRead = statSync(this.filePath).size;

    try {
      this.watcher = watch(this.filePath, () => {
        if (!this.stopped) this.readNewLines();
      });
    } catch {
      // Fallback to polling
      this.pollTimer = setInterval(() => {
        if (!this.stopped) this.readNewLines();
      }, 300);
    }
  }

  private readNewLines(): void {
    if (!this.filePath || !existsSync(this.filePath)) return;

    try {
      const size = statSync(this.filePath).size;
      if (size <= this.bytesRead) return;

      const newContent = readFileSync(this.filePath).subarray(this.bytesRead).toString('utf-8');
      this.bytesRead = size;

      for (const line of newContent.split('\n')) {
        if (line.trim()) this.processLine(line.trim());
      }
    } catch (err) {
      console.error('[session-watcher] Read error:', err);
    }
  }

  private processLine(line: string): void {
    try {
      const obj = JSON.parse(line);

      if (this.agent === 'claude') {
        this.processClaudeLine(obj);
      } else {
        this.processCodexLine(obj);
      }
    } catch {
      // Invalid JSON, skip
    }
  }

  // ── Claude format ──

  private processClaudeLine(obj: Record<string, unknown>): void {
    const type = obj.type as string;

    if (type === 'user') {
      const content = this.extractClaudeContent(obj);
      if (content && !this.seenContent.has(content.trim())) {
        this.createMessage('user', content);
      }
    } else if (type === 'assistant') {
      const content = this.extractClaudeContent(obj);
      if (content) {
        this.createMessage('agent', content);
      }
    }
  }

  private extractClaudeContent(obj: Record<string, unknown>): string {
    if (typeof obj.content === 'string') return obj.content.trim();

    const message = obj.message as Record<string, unknown> | undefined;
    if (message?.content && Array.isArray(message.content)) {
      return (message.content as Array<{ type: string; text?: string }>)
        .filter((p) => p.type === 'text' && p.text)
        .map((p) => p.text!)
        .join('\n')
        .trim();
    }
    if (typeof message?.content === 'string') return message.content.trim();
    return '';
  }

  // ── Codex format ──

  private processCodexLine(obj: Record<string, unknown>): void {
    const type = obj.type as string;
    const payload = obj.payload as Record<string, unknown> | undefined;
    if (!payload) return;

    if (type === 'event_msg') {
      const evtType = payload.type as string;

      if (evtType === 'user_message') {
        const content = (payload.message as string) ?? '';
        if (content.trim() && !this.seenContent.has(content.trim())) {
          this.createMessage('user', content.trim());
        }
      } else if (evtType === 'agent_message') {
        const content = (payload.message as string) ?? '';
        if (content.trim()) {
          this.createMessage('agent', content.trim());
        }
      }
    }
  }

  // ── Common ──

  private createMessage(role: 'user' | 'agent', content: string): void {
    messageService.create({
      roomId: this.roomId,
      sessionId: this.sessionId,
      agent: this.agent,
      role,
      content,
      selectable: true,
    }).catch((err) => console.error(`[session-watcher] Failed to create ${role} msg:`, err));
  }

  // ── File discovery ──

  private findSessionFile(cwd: string): string | null {
    if (this.agent === 'claude') {
      return this.findClaudeSessionFile(cwd);
    } else {
      return this.findCodexSessionFile(cwd);
    }
  }

  private findClaudeSessionFile(cwd: string): string | null {
    const encoded = cwd.replace(/[/_]/g, '-');
    const dir = join(homedir(), '.claude', 'projects', encoded);
    return this.findLatestJsonl(dir);
  }

  private findCodexSessionFile(cwd: string): string | null {
    // Codex stores sessions by date: ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
    // We find the most recent one whose session_meta.cwd matches our CWD
    const sessionsRoot = join(homedir(), '.codex', 'sessions');
    if (!existsSync(sessionsRoot)) return null;

    try {
      // Scan date directories in reverse order (most recent first)
      const years = readdirSync(sessionsRoot).sort().reverse();
      for (const year of years) {
        const yearDir = join(sessionsRoot, year);
        if (!statSync(yearDir).isDirectory()) continue;

        const months = readdirSync(yearDir).sort().reverse();
        for (const month of months) {
          const monthDir = join(yearDir, month);
          if (!statSync(monthDir).isDirectory()) continue;

          const days = readdirSync(monthDir).sort().reverse();
          for (const day of days) {
            const dayDir = join(monthDir, day);
            if (!statSync(dayDir).isDirectory()) continue;

            const files = readdirSync(dayDir)
              .filter((f) => f.endsWith('.jsonl'))
              .map((f) => ({ path: join(dayDir, f), mtime: statSync(join(dayDir, f)).mtimeMs }))
              .sort((a, b) => b.mtime - a.mtime);

            // Check if any file's session_meta.cwd matches
            for (const file of files) {
              if (this.codexSessionMatchesCwd(file.path, cwd)) {
                return file.path;
              }
            }
          }
          // Only check the most recent day with files
          return null;
        }
      }
    } catch {
      return null;
    }
    return null;
  }

  private codexSessionMatchesCwd(filePath: string, cwd: string): boolean {
    try {
      // Read just the first line (session_meta)
      const content = readFileSync(filePath, 'utf-8');
      const firstLine = content.split('\n')[0];
      if (!firstLine) return false;

      const obj = JSON.parse(firstLine);
      if (obj.type !== 'session_meta') return false;

      const sessionCwd = obj.payload?.cwd as string;
      return sessionCwd === cwd;
    } catch {
      return false;
    }
  }

  private findLatestJsonl(dir: string): string | null {
    if (!existsSync(dir)) return null;
    try {
      const files = readdirSync(dir)
        .filter((f) => f.endsWith('.jsonl'))
        .map((f) => ({ path: join(dir, f), mtime: statSync(join(dir, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);
      return files[0]?.path ?? null;
    } catch {
      return null;
    }
  }
}
