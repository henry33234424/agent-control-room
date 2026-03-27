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
  private term: InstanceType<typeof Terminal>;
  private lastContentHash = '';
  private lastAgentContent = '';

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

    // Extract agent blocks marked with ⏺ (Claude) or · (Codex)
    const agentContent = extractAgentBlocks(currentLines);

    if (!agentContent || agentContent === this.lastAgentContent) {
      return '';
    }

    // Only return the NEW content (what wasn't in the last extraction)
    let delta = agentContent;
    if (this.lastAgentContent && agentContent.startsWith(this.lastAgentContent)) {
      delta = agentContent.slice(this.lastAgentContent.length).trim();
    }

    this.lastAgentContent = agentContent;
    return delta;
  }

  dispose(): void {
    this.term.dispose();
  }
}

/**
 * Agent block marker patterns:
 * - Claude: ⏺ at the start of a line
 * - Codex: · at the start of a line (but not inside indented sub-blocks)
 */
const BLOCK_START = /^[⏺·]\s/;
const BLOCK_END = /^[❯>]\s|^[─━═]{3,}|^gpt-|^>_\s/;

export function extractAgentBlocks(lines: string[]): string {
  const blocks: string[] = [];
  let inBlock = false;
  let currentBlock: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    // Start of agent block
    if (BLOCK_START.test(trimmed)) {
      pushBlock(blocks, currentBlock);
      const content = trimmed.replace(/^[⏺·]\s*/, '').trim();
      const firstLine = isTransientStatusLine(content) ? '' : content;
      currentBlock = firstLine ? [firstLine] : [];
      inBlock = true;
      continue;
    }

    if (!inBlock) continue;

    // End of block
    if (BLOCK_END.test(trimmed)) { inBlock = false; continue; }
    if (!isMeaningfulLine(line)) continue;

    // Sub-block markers (indented · in Codex)
    if (/^\s+·\s/.test(line)) {
      pushLine(currentBlock, trimmed.replace(/^·\s*/, '- '));
      continue;
    }

    pushLine(currentBlock, trimmed);
  }

  pushBlock(blocks, currentBlock);

  return blocks.join('\n\n');
}

function pushBlock(blocks: string[], currentBlock: string[]): void {
  const normalized = normalizeBlock(currentBlock);
  if (!normalized) return;
  if (blocks[blocks.length - 1] === normalized) return;
  blocks.push(normalized);
}

function pushLine(lines: string[], line: string): void {
  const normalized = line.trim();
  if (!normalized) return;
  if (lines[lines.length - 1] === normalized) return;
  lines.push(normalized);
}

function normalizeBlock(lines: string[]): string {
  const normalized = lines
    .map((line) => line.trim())
    .filter(Boolean);
  if (normalized.length === 0) return '';
  return normalized.join('\n');
}

function isTransientStatusLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (/^(?:Working|Thinking|Zigzagging|Slithering|Photosynthesizing)(?:\.\.\.|…)?$/i.test(trimmed)) {
    return true;
  }
  if (/^[A-Z][a-z]+(?:ing|izing|ering)(?:\.\.\.|…)?$/.test(trimmed)) {
    return true;
  }
  return false;
}

/**
 * Determine if a line contains meaningful assistant output vs TUI chrome.
 */
function isMeaningfulLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;

  // --- TUI decorations ---
  // Box-drawing / separator lines
  if (/^[─━═╭╮╰╯│┃┌┐└┘├┤┬┴┼╱╲╳▐▛▜▟▙▘▝▗▖▚▞\s]+$/.test(trimmed)) return false;
  // Spinners
  if (/^[✻✽✶✳✢◐◑◒◓◴◵◶◷⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏⏺\s]+$/.test(trimmed)) return false;
  // Prompt line (with or without text after)
  if (/^❯\s*$/.test(trimmed)) return false;
  // Prompt line with user input echo (e.g. "❯ 嗨" or "❯ hello")
  if (/^❯\s+.+/.test(trimmed)) return false;

  // --- Claude Code UI chrome ---
  if (/Claude Code/i.test(trimmed) && /v\d+\.\d+/i.test(trimmed)) return false;
  if (/Photosynthesizing|Working…|Working\.\.\./i.test(trimmed)) return false;
  if (isTransientStatusLine(trimmed)) return false;
  if (/esc\s+to\s+interrupt/i.test(trimmed)) return false;
  if (/\?\s+for\s+shortcuts/i.test(trimmed)) return false;
  if (/for\s+shortcuts/i.test(trimmed)) return false;
  if (/medium\s+·\s+\/effort/i.test(trimmed)) return false;
  if (/low\s+·\s+\/effort/i.test(trimmed)) return false;
  if (/high\s+·\s+\/effort/i.test(trimmed)) return false;
  if (/max\s+·\s+\/effort/i.test(trimmed)) return false;
  if (/Welcome\s+back/i.test(trimmed)) return false;
  if (/Tips\s+for\s+getting\s+started/i.test(trimmed)) return false;
  if (/Recent\s+activity/i.test(trimmed)) return false;
  if (/No\s+recent\s+activity/i.test(trimmed)) return false;
  if (/Run\s+\/init\s+to\s+create/i.test(trimmed)) return false;
  if (/remote-control.*is\s+active/i.test(trimmed)) return false;
  if (/upgrade.*Claude\s+mobile\s+app/i.test(trimmed)) return false;
  if (/Opus.*context.*Claude\s+Max/i.test(trimmed)) return false;
  if (/Sonnet.*context/i.test(trimmed)) return false;
  if (/Haiku.*context/i.test(trimmed)) return false;
  if (/Organization/i.test(trimmed) && /@.*\.com/i.test(trimmed)) return false;
  if (/^~\/.*Projects\//i.test(trimmed)) return false;
  if (/claude\.ai\/code\/session/i.test(trimmed)) return false;
  if (/Code\s+in\s+CLI\s+or\s+at/i.test(trimmed)) return false;
  if (/Please\s+upgrade.*mobile\s+app/i.test(trimmed)) return false;

  // Tool use chrome (Read N file, ctrl+o to expand, etc.)
  if (/^Read\s+\d+\s+file/i.test(trimmed)) return false;
  if (/ctrl\+o\s+to\s+expand/i.test(trimmed)) return false;

  // Single-char or very short spinner residues
  if (/^[a-z]{1,3}…?$/.test(trimmed)) return false;

  // Lines that are just a single symbol/emoji with nothing else
  if (/^[⏺⏹⏸▶⏵⏯⏮⏭]\s*$/.test(trimmed)) return false;

  // Terminal color query responses (RGB values) — any line containing rgb: patterns
  if (/rgb:[0-9a-f]{2,4}\/[0-9a-f]{2,4}\/[0-9a-f]{2,4}/i.test(trimmed)) return false;
  if (/^\d+;rgb:/i.test(trimmed)) return false;

  // Codex TUI chrome
  if (/^>_\s+OpenAI\s+Codex/i.test(trimmed)) return false;
  if (/^gpt-/i.test(trimmed)) return false;
  if (/^model:/i.test(trimmed)) return false;
  if (/^directory:/i.test(trimmed)) return false;
  if (/^Tip:\s+/i.test(trimmed)) return false;
  if (/\/fast\s+to\s+enable/i.test(trimmed)) return false;
  if (/\/model\s+to\s+change/i.test(trimmed)) return false;
  if (/Write\s+tests\s+for\s+@filename/i.test(trimmed)) return false;
  if (/Find\s+and\s+fix\s+a\s+bug\s+in\s+@filename/i.test(trimmed)) return false;
  if (/^\d+%\s+left/i.test(trimmed)) return false;
  if (/xhigh/i.test(trimmed) && /left/i.test(trimmed)) return false;

  // Handoff context echo (should not appear as agent reply)
  if (/^\[Control\s+Room\s+Context\]/i.test(trimmed)) return false;
  if (/^\[New\s+Instruction\]/i.test(trimmed)) return false;
  if (/^The\s+following\s+transcript\s+was\s+explicitly\s+selected/i.test(trimmed)) return false;
  if (/^\[agent\s+\(/i.test(trimmed)) return false;

  return true;
}
