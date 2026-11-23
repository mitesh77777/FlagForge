import { describe, expect, it, vi } from 'vitest';
import { Singleflight } from './singleflight.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('Singleflight', () => {
  it('runs the loader once for concurrent callers on the same key', async () => {
    const flight = new Singleflight();
    const gate = deferred<string>();
    const loader = vi.fn(() => gate.promise);

    const calls = [
      flight.run('env_1', loader),
      flight.run('env_1', loader),
      flight.run('env_1', loader),
    ];

    gate.resolve('snapshot');
    const results = await Promise.all(calls);

    expect(loader).toHaveBeenCalledTimes(1);
    expect(results.map((r) => r.value)).toEqual([
      'snapshot',
      'snapshot',
      'snapshot',
    ]);
    // Exactly one caller started the load; the other two joined it.
    expect(results.filter((r) => r.joined)).toHaveLength(2);
    expect(flight.coalescedCalls).toBe(2);
    expect(flight.size).toBe(0);
  });

  it('does not coalesce different keys', async () => {
    const flight = new Singleflight();
    const loader = vi.fn(async (id: string) => `snapshot:${id}`);

    const [a, b] = await Promise.all([
      flight.run('env_1', () => loader('env_1')),
      flight.run('env_2', () => loader('env_2')),
    ]);

    expect(loader).toHaveBeenCalledTimes(2);
    expect(a.value).toBe('snapshot:env_1');
    expect(b.value).toBe('snapshot:env_2');
    expect(a.joined).toBe(false);
    expect(b.joined).toBe(false);
  });

  it('starts a fresh load once the previous one has settled', async () => {
    const flight = new Singleflight();
    const loader = vi.fn(async () => 'value');

    const first = await flight.run('k', loader);
    const second = await flight.run('k', loader);

    expect(loader).toHaveBeenCalledTimes(2);
    expect(first.joined).toBe(false);
    expect(second.joined).toBe(false);
    expect(flight.size).toBe(0);
  });

  it('propagates a rejection to every caller and clears the entry', async () => {
    const flight = new Singleflight();
    const fail = deferred<never>();
    const loader = vi.fn(() => fail.promise);

    const first = flight.run('k', loader).catch((e: Error) => e.message);
    const second = flight.run('k', loader).catch((e: Error) => e.message);

    fail.reject(new Error('db down'));

    expect(await first).toBe('db down');
    expect(await second).toBe('db down');
    expect(loader).toHaveBeenCalledTimes(1);
    // The failed entry must not be retained, or the key would be poisoned.
    expect(flight.size).toBe(0);

    await expect(flight.run('k', async () => 'ok')).resolves.toEqual({
      value: 'ok',
      joined: false,
    });
  });
});
