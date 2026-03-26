/**
 * Sanitize sensitive data from runtime event text and payloads.
 * Redacts tokens, cookies, Authorization headers, private keys.
 */

const SENSITIVE_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /sk-ant-[a-zA-Z0-9_-]{20,}/g, replacement: '[REDACTED_ANTHROPIC_KEY]' },
  { pattern: /sk-[a-zA-Z0-9]{20,}/g, replacement: '[REDACTED_API_KEY]' },
  { pattern: /Bearer\s+[a-zA-Z0-9._-]{20,}/gi, replacement: 'Bearer [REDACTED]' },
  { pattern: /Authorization:\s*[^\n\r]{10,}/gi, replacement: 'Authorization: [REDACTED]' },
  { pattern: /cookie:\s*[^\n\r]{10,}/gi, replacement: 'cookie: [REDACTED]' },
  { pattern: /-----BEGIN\s+(RSA\s+)?PRIVATE KEY-----[\s\S]*?-----END\s+(RSA\s+)?PRIVATE KEY-----/g, replacement: '[REDACTED_PRIVATE_KEY]' },
  { pattern: /ghp_[a-zA-Z0-9]{36}/g, replacement: '[REDACTED_GITHUB_TOKEN]' },
];

export function sanitizeText(text: unknown): string {
  if (typeof text !== 'string') return String(text ?? '');
  let result = text;
  for (const { pattern, replacement } of SENSITIVE_PATTERNS) {
    pattern.lastIndex = 0;
    result = result.replace(pattern, replacement);
  }
  return result;
}

export function sanitizePayload(payload: unknown): Record<string, unknown> | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  try {
    return JSON.parse(sanitizeText(JSON.stringify(payload)));
  } catch {
    return payload as Record<string, unknown>;
  }
}
