import { watch, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { AgentKind } from '@control-room/shared-types';
import { messageService } from '../services/message-service.js';

/**
 * Watches Claude CLI session JSONL files for new messages.
 * Claude writes all conversation data to:
 *   ~/.claude/projects/<cwd-encoded>/<session-uuid>.jsonl
 *
 * This provides clean, structured message data without parsing TUI output.
 */
export class SessionWatcher {
  private watcher: ReturnType<typeof watch> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private bytesRead = 0;
  private filePath: string | null = null;
  private roomId: string;
  private sessionId: string;
  private agent: AgentKind;
  private seenUuids = new Set<string>();
  private stopped = false;

  constructor(input: {
    roomId: string;
    sessionId: string;
    agent: AgentKind;
  }) {
    this.roomId = input.roomId;
    this.sessionId = input.sessionId;
    this.agent = input.agent;
  }

  /**
   * Start watching for session file changes.
   * @param cwd The working directory where the CLI was started
   */
  start(cwd: string): void {
    this.stopped = false;
    const sessionDir = this.getSessionDir(cwd);

    // Poll for the session file to appear (CLI may not have created it yet)
    this.pollTimer = setInterval(() => {
      if (this.stopped) return;

      const file = this.findLatestJsonl(sessionDir);
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
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private startWatching(): void {
    if (!this.filePath || !existsSync(this.filePath)) return;

    // Read existing content first (skip — we only want new messages)
    const stat = statSync(this.filePath);
    this.bytesRead = stat.size;

    // Watch for changes
    try {
      this.watcher = watch(this.filePath, () => {
        if (this.stopped) return;
        this.readNewLines();
      });
    } catch {
      // fs.watch not reliable on all platforms, use polling fallback
      this.pollTimer = setInterval(() => {
        if (this.stopped) return;
        this.readNewLines();
      }, 300);
    }
  }

  private readNewLines(): void {
    if (!this.filePath || !existsSync(this.filePath)) return;

    try {
      const stat = statSync(this.filePath);
      if (stat.size <= this.bytesRead) return;

      // Read only the new bytes
      const fd = readFileSync(this.filePath);
      const newContent = fd.subarray(this.bytesRead).toString('utf-8');
      this.bytesRead = stat.size;

      const lines = newContent.split('\n').filter((l) => l.trim());

      for (const line of lines) {
        this.processLine(line);
      }
    } catch (err) {
      console.error('[session-watcher] Read error:', err);
    }
  }

  private processLine(line: string): void {
    try {
      const obj = JSON.parse(line);
      const uuid = obj.uuid as string | undefined;

      // Dedup by uuid
      if (uuid) {
        if (this.seenUuids.has(uuid)) return;
        this.seenUuids.add(uuid);
      }

      const type = obj.type as string;

      // Only sync assistant messages — user messages are already created by:
      // - Chat input API (for messages sent from chat panel)
      // - We skip them here to avoid duplicates
      if (type === 'assistant') {
        // Assistant response — create agent message in chat
        const content = this.extractContent(obj);
        if (content) {
          messageService.create({
            roomId: this.roomId,
            sessionId: this.sessionId,
            agent: this.agent,
            role: 'agent',
            content,
            selectable: true,
          }).catch((err) => console.error('[session-watcher] Failed to create agent msg:', err));
        }
      }
      // Ignore other types (system, file-history-snapshot, tool_use, tool_result, etc.)
    } catch {
      // Invalid JSON line, skip
    }
  }

  private extractContent(obj: Record<string, unknown>): string {
    // Direct content field
    if (typeof obj.content === 'string') return obj.content;

    // Nested message.content (array of content blocks)
    const message = obj.message as Record<string, unknown> | undefined;
    if (message?.content && Array.isArray(message.content)) {
      return (message.content as Array<{ type: string; text?: string }>)
        .filter((p) => p.type === 'text' && p.text)
        .map((p) => p.text!)
        .join('\n')
        .trim();
    }

    // User messages may have content directly
    if (typeof message?.content === 'string') return message.content;

    return '';
  }

  /**
   * Convert CWD to Claude's session directory path.
   * Claude replaces / and _ with - in the directory name.
   * /Users/henry/Documents/MyProjects/vlookup_pro → -Users-henry-Documents-MyProjects-vlookup-pro
   */
  private getSessionDir(cwd: string): string {
    const encoded = cwd.replace(/[/_]/g, '-');
    return join(homedir(), '.claude', 'projects', encoded);
  }

  /**
   * Find the most recently modified .jsonl file in a directory.
   */
  private findLatestJsonl(dir: string): string | null {
    if (!existsSync(dir)) return null;

    try {
      const files = readdirSync(dir)
        .filter((f) => f.endsWith('.jsonl'))
        .map((f) => {
          const fullPath = join(dir, f);
          return { path: fullPath, mtime: statSync(fullPath).mtimeMs };
        })
        .sort((a, b) => b.mtime - a.mtime);

      return files[0]?.path ?? null;
    } catch {
      return null;
    }
  }
}
