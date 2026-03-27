import { watch, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { homedir } from 'node:os';
import type { AgentKind } from '@control-room/shared-types';
import { messageService } from '../services/message-service.js';

interface SessionFileMatch {
  path: string;
  readFromStart: boolean;
  vendorSessionId?: string;
}

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
  private startedAtMs = 0;
  private vendorSessionId?: string;
  private roomId: string;
  private sessionId: string;
  private agent: AgentKind;
  private pendingSentContent = new Map<string, number>(); // consume-once dedup for chat API prompts
  private stopped = false;
  private onVendorSessionId?: (vendorSessionId: string) => void;

  constructor(input: {
    roomId: string;
    sessionId: string;
    agent: AgentKind;
    onVendorSessionId?: (vendorSessionId: string) => void;
  }) {
    this.roomId = input.roomId;
    this.sessionId = input.sessionId;
    this.agent = input.agent;
    this.onVendorSessionId = input.onVendorSessionId;
  }

  /**
   * Register a user message content that was already created via chat API.
   * SessionWatcher will skip the next matching content to avoid duplicates.
   */
  markSent(content: string): void {
    const normalized = normalizeContent(content);
    if (!normalized) return;

    this.pendingSentContent.set(normalized, (this.pendingSentContent.get(normalized) ?? 0) + 1);

    // Keep map bounded
    if (this.pendingSentContent.size > 50) {
      const first = this.pendingSentContent.keys().next().value;
      if (first) this.pendingSentContent.delete(first);
    }
  }

  start(cwd: string, vendorSessionId?: string): void {
    this.stopped = false;
    this.startedAtMs = Date.now();
    this.vendorSessionId = vendorSessionId;

    // Poll for the session file to appear
    this.pollTimer = setInterval(() => {
      if (this.stopped) return;

      const match = this.findSessionFile(cwd);
      if (match) {
        this.startWatching(match);
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
    this.filePath = null;
    this.bytesRead = 0;
  }

  private startWatching(match: SessionFileMatch): void {
    this.filePath = match.path;
    if (!existsSync(this.filePath)) return;

    if (match.vendorSessionId && match.vendorSessionId !== this.vendorSessionId) {
      this.vendorSessionId = match.vendorSessionId;
      this.onVendorSessionId?.(match.vendorSessionId);
    }

    this.bytesRead = match.readFromStart ? 0 : statSync(this.filePath).size;

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

    if (match.readFromStart) {
      this.readNewLines();
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
      if (content && !this.consumePendingSent(content)) {
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
        if (content.trim() && !this.consumePendingSent(content)) {
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

  private consumePendingSent(content: string): boolean {
    const normalized = normalizeContent(content);
    const count = this.pendingSentContent.get(normalized) ?? 0;
    if (count <= 0) return false;

    if (count === 1) {
      this.pendingSentContent.delete(normalized);
    } else {
      this.pendingSentContent.set(normalized, count - 1);
    }
    return true;
  }

  private findSessionFile(cwd: string): SessionFileMatch | null {
    if (this.agent === 'claude') {
      return this.findClaudeSessionFile(cwd);
    }
    return this.findCodexSessionFile(cwd);
  }

  private findClaudeSessionFile(cwd: string): SessionFileMatch | null {
    const encoded = cwd.replace(/[/_]/g, '-');
    const dir = join(homedir(), '.claude', 'projects', encoded);

    if (this.vendorSessionId) {
      const exactPath = join(dir, `${this.vendorSessionId}.jsonl`);
      if (existsSync(exactPath)) {
        return {
          path: exactPath,
          readFromStart: false,
          vendorSessionId: this.vendorSessionId,
        };
      }
    }

    return this.findRecentJsonl(dir);
  }

  private findCodexSessionFile(cwd: string): SessionFileMatch | null {
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
              const match = this.codexSessionMatchesCwd(file.path, cwd);
              if (!match) continue;

              const readFromStart = !this.vendorSessionId && file.mtime >= this.startedAtMs;
              if (this.vendorSessionId && match.vendorSessionId !== this.vendorSessionId) {
                continue;
              }

              return {
                path: file.path,
                readFromStart,
                vendorSessionId: match.vendorSessionId,
              };
            }
          }
        }
      }
    } catch {
      return null;
    }
    return null;
  }

  private codexSessionMatchesCwd(
    filePath: string,
    cwd: string,
  ): { vendorSessionId?: string } | null {
    try {
      // Read just the first line (session_meta)
      const content = readFileSync(filePath, 'utf-8');
      const firstLine = content.split('\n')[0];
      if (!firstLine) return null;

      const obj = JSON.parse(firstLine);
      if (obj.type !== 'session_meta') return null;

      const sessionCwd = obj.payload?.cwd as string;
      if (sessionCwd !== cwd) return null;

      const vendorSessionId = extractCodexVendorSessionId(obj);
      return { vendorSessionId };
    } catch {
      return null;
    }
  }

  private findRecentJsonl(dir: string): SessionFileMatch | null {
    if (!existsSync(dir)) return null;
    try {
      const files = readdirSync(dir)
        .filter((f) => f.endsWith('.jsonl'))
        .map((f) => ({ path: join(dir, f), mtime: statSync(join(dir, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);

      if (files.length === 0) return null;

      if (this.vendorSessionId) {
        const exact = files.find((file) => basename(file.path, '.jsonl') === this.vendorSessionId);
        if (!exact) return null;
        return {
          path: exact.path,
          readFromStart: false,
          vendorSessionId: basename(exact.path, '.jsonl'),
        };
      }

      const recent = files.find((file) => file.mtime >= this.startedAtMs);
      if (!recent) return null;

      return {
        path: recent.path,
        readFromStart: true,
        vendorSessionId: basename(recent.path, '.jsonl'),
      };
    } catch {
      return null;
    }
  }
}

function normalizeContent(content: string): string {
  return content.trim();
}

function extractCodexVendorSessionId(obj: Record<string, unknown>): string | undefined {
  const payload = obj.payload as Record<string, unknown> | undefined;
  const candidates = [
    payload?.sessionId,
    payload?.session_id,
    payload?.threadId,
    payload?.thread_id,
    (payload?.thread as Record<string, unknown> | undefined)?.id,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate) {
      return candidate;
    }
  }

  return undefined;
}
