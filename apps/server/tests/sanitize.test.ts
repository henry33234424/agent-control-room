import { describe, it, expect } from 'vitest';
import { sanitizeText } from '@control-room/runtime-events';

describe('sanitizeText', () => {
  it('redacts Anthropic API keys', () => {
    const input = 'key is sk-ant-api03-abcdefghijklmnopqrst';
    expect(sanitizeText(input)).toContain('[REDACTED_ANTHROPIC_KEY]');
    expect(sanitizeText(input)).not.toContain('sk-ant-');
  });

  it('redacts OpenAI API keys', () => {
    // sk- pattern requires 20+ alphanumeric chars
    const input = 'OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz0123456789';
    expect(sanitizeText(input)).toContain('[REDACTED_API_KEY]');
  });

  it('redacts Authorization headers', () => {
    const input = 'Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig';
    // The Authorization pattern matches the whole header
    expect(sanitizeText(input)).toContain('Authorization: [REDACTED]');
    expect(sanitizeText(input)).not.toContain('eyJhbGci');
  });

  it('redacts GitHub tokens', () => {
    const input = 'token: ghp_abcdefghijklmnopqrstuvwxyz0123456789';
    expect(sanitizeText(input)).toContain('[REDACTED_GITHUB_TOKEN]');
  });

  it('redacts private keys', () => {
    const input = '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg...\n-----END PRIVATE KEY-----';
    expect(sanitizeText(input)).toContain('[REDACTED_PRIVATE_KEY]');
  });

  it('leaves normal text untouched', () => {
    const input = 'Hello world, this is a normal message with no secrets';
    expect(sanitizeText(input)).toBe(input);
  });
});
