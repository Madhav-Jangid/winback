import { describe, expect, it } from 'vitest';
import { parseServerEnv } from './env';

describe('server environment validation', () => {
  it('provides safe demo defaults without requiring database or provider credentials', () => {
    expect(parseServerEnv({})).toEqual({
      NEXT_PUBLIC_APP_NAME: 'Winback AI',
      DEMO_MODE: 'true',
      DEMO_SEED: 'winback-demo-v1',
    });
  });

  it('treats an empty DATABASE_URL as unconfigured', () => {
    expect(parseServerEnv({ DATABASE_URL: '' }).DATABASE_URL).toBeUndefined();
  });

  it('accepts a valid PostgreSQL URL and explicit demo settings', () => {
    expect(parseServerEnv({
      DATABASE_URL: 'postgresql://demo:demo@localhost:5432/winback',
      DEMO_MODE: 'false',
      DEMO_SEED: 'local-seed',
    })).toMatchObject({
      DATABASE_URL: 'postgresql://demo:demo@localhost:5432/winback',
      DEMO_MODE: 'false',
      DEMO_SEED: 'local-seed',
    });
  });

  it('rejects malformed database URLs and boolean values', () => {
    expect(() => parseServerEnv({ DATABASE_URL: 'mysql://localhost/winback' })).toThrow(/DATABASE_URL/);
    expect(() => parseServerEnv({ DEMO_MODE: 'yes' })).toThrow(/DEMO_MODE/);
  });
});
