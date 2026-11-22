import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

/**
 * `loadConfig` is the first thing that runs at boot, so a throwing or
 * mis-resolving config is a total outage. Two classes of bug matter most:
 *
 *  1. `.env` files and docker-compose commonly define a variable with **no
 *     value** (`LLM_API_KEY=`), which arrives as an empty string. Optional
 *     fields use `.min(1)`, so an empty string would fail validation and crash
 *     the container on start.
 *  2. Managed hosts inject `PORT` rather than `API_PORT`; ignoring it leaves the
 *     container listening on a port nothing forwards to.
 */
describe('loadConfig', () => {
  it('applies working defaults with an empty environment', () => {
    const config = loadConfig({});
    expect(config.NODE_ENV).toBe('development');
    expect(config.API_HOST).toBe('0.0.0.0');
    expect(config.API_PORT).toBe(8080);
    expect(config.corsOrigins).toEqual(['http://localhost:3000']);
    expect(config.CACHE_NAMESPACE).toBe('flagforge');
    expect(config.L2_CACHE_TTL_SECONDS).toBe(300);
    expect(config.ADMIN_API_TOKEN).toBeUndefined();
    expect(config.LLM_API_KEY).toBeUndefined();
    expect(config.LLM_MODEL).toBe('gpt-4o-mini');
  });

  it('treats empty-string secrets as absent instead of failing validation', () => {
    // This is exactly what `docker compose` produces for
    //   LLM_API_KEY: ${LLM_API_KEY:-}
    expect(() =>
      loadConfig({ ADMIN_API_TOKEN: '', LLM_API_KEY: '', SEED_DEMO: '' }),
    ).not.toThrow();

    const config = loadConfig({ ADMIN_API_TOKEN: '   ', LLM_API_KEY: '' });
    expect(config.ADMIN_API_TOKEN).toBeUndefined();
    expect(config.LLM_API_KEY).toBeUndefined();
  });

  it('falls back to the platform-injected PORT', () => {
    expect(loadConfig({ PORT: '9000' }).API_PORT).toBe(9000);
  });

  it('prefers an explicit API_PORT over PORT', () => {
    expect(loadConfig({ API_PORT: '7000', PORT: '9000' }).API_PORT).toBe(7000);
  });

  it('ignores unusable PORT values and keeps the default', () => {
    expect(loadConfig({ PORT: '' }).API_PORT).toBe(8080);
    expect(loadConfig({ PORT: 'not-a-number' }).API_PORT).toBe(8080);
    expect(loadConfig({ PORT: '0' }).API_PORT).toBe(8080);
    expect(loadConfig({ PORT: '-1' }).API_PORT).toBe(8080);
    expect(loadConfig({ PORT: '8080.5' }).API_PORT).toBe(8080);
  });

  it('leaves the default in place when a defaulted variable is blank', () => {
    const config = loadConfig({ DATABASE_URL: '', REDIS_URL: '' });
    expect(config.DATABASE_URL).toBe(
      'postgres://flagforge:flagforge@localhost:5432/flagforge',
    );
    expect(config.REDIS_URL).toBe('redis://localhost:6379');
  });

  it('splits, trims and drops blanks in CORS_ORIGINS', () => {
    const config = loadConfig({
      CORS_ORIGINS: 'https://a.example.com, https://b.example.com ,',
    });
    expect(config.corsOrigins).toEqual([
      'https://a.example.com',
      'https://b.example.com',
    ]);
  });
});
