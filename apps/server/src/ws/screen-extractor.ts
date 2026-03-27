import { createRequire } from 'node:module';

// @xterm/headless doesn't export ESM properly, use require
const require_ = createRequire(import.meta.url);
const { Terminal } = require_('@xterm/headless');

/**
 * Uses a headless xterm Terminal to properly process TUI output.
 * Maintains a virtual screen buffer and extracts meaningful text changes
 * by diffing screen snapshots.
 */
export class ScreenExtractor {
  private term: Terminal;
  private lastSnapshot: string[] = [];
  private lastContentHash = '';

  constructor(cols = 120, rows = 40) {
    this.term = new Terminal({ cols, rows, allowProposedApi: true });
  }

  /**
   * Feed raw PTY data into the headless terminal.
   */
  write(data: string): void {
    this.term.write(data);
  }

  /**
   * Resize the headless terminal to match the real PTY.
   */
  resize(cols: number, rows: number): void {
    this.term.resize(cols, rows);
  }

  /**
   * Read the current screen content as an array of lines.
   */
  readScreen(): string[] {
    const buffer = this.term.buffer.active;
    const lines: string[] = [];

    for (let i = 0; i < buffer.length; i++) {
      const line = buffer.getLine(i);
      if (line) {
        lines.push(line.translateToString(true));
      }
    }

    return lines;
  }

  /**
   * Extract new meaningful content since the last call.
   * Returns empty string if nothing changed, or the new content.
   */
  extractDelta(): string {
    const currentLines = this.readScreen();
    const currentContent = currentLines.map((l) => l.trimEnd()).join('\n').trimEnd();

    // Quick check: if content hash hasn't changed, skip
    if (currentContent === this.lastContentHash) {
      return '';
    }
    this.lastContentHash = currentContent;

    // Find meaningful lines (not empty, not TUI decorations)
    const meaningfulLines = currentLines
      .map((l) => l.trimEnd())
      .filter((l) => isMeaningfulLine(l));

    // Diff against last snapshot
    const previousSet = new Set(this.lastSnapshot);
    const newLines = meaningfulLines.filter((l) => !previousSet.has(l));

    this.lastSnapshot = meaningfulLines;

    if (newLines.length === 0) return '';

    return newLines.join('\n');
  }

  dispose(): void {
    this.term.dispose();
  }
}

/**
 * Determine if a line contains meaningful assistant output vs TUI chrome.
 */
function isMeaningfulLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;

  // Filter TUI decorations
  if (/^[─━═╭╮╰╯│┃┌┐└┘├┤┬┴┼\s]+$/.test(trimmed)) return false;
  if (/^[✻✽✶✳◐◑◒◓◴◵◶◷⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏\s]+$/.test(trimmed)) return false;
  if (/^❯\s*$/.test(trimmed)) return false;
  if (/Claude Code/i.test(trimmed) && /v\d+\.\d+/i.test(trimmed)) return false;
  if (/Photosynthesizing|Working…|Working\.\.\./i.test(trimmed)) return false;
  if (/esc\s+to\s+interrupt/i.test(trimmed)) return false;
  if (/^\?\s+for\s+shortcuts/i.test(trimmed)) return false;
  if (/medium\s+·\s+\/effort/i.test(trimmed)) return false;
  if (/Welcome\s+back/i.test(trimmed)) return false;
  if (/Tips\s+for\s+getting\s+started/i.test(trimmed)) return false;
  if (/Recent\s+activity/i.test(trimmed)) return false;
  if (/No\s+recent\s+activity/i.test(trimmed)) return false;
  if (/Run\s+\/init\s+to\s+create/i.test(trimmed)) return false;
  if (/remote-control.*is\s+active/i.test(trimmed)) return false;
  if (/upgrade.*Claude\s+mobile\s+app/i.test(trimmed)) return false;
  if (/Opus.*context.*Claude\s+Max/i.test(trimmed)) return false;
  if (/Organization/i.test(trimmed) && /@.*\.com/i.test(trimmed)) return false;
  if (/^~\/.*Projects\//i.test(trimmed)) return false;

  // Single-char or very short spinner residues
  if (/^[a-z]{1,3}…?$/.test(trimmed)) return false;

  return true;
}
