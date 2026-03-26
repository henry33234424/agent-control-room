import { describe, it, expect } from 'vitest';
import { corsMethods } from '../src/config.js';

describe('CORS config', () => {
  it('allows cross-origin write methods used by the web app', () => {
    expect(corsMethods).toEqual(
      expect.arrayContaining(['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']),
    );
  });
});
