import { describe, expect, it, vi } from 'vitest';
import { FlagForgeClient, type FetchLike } from './index.js';

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly listeners = new Map<string, Array<(event: { data: string }) => void>>();
  closed = false;

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, cb: (event: { data: string }) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(cb);
    this.listeners.set(type, list);
  }

  close(): void {
    this.closed = true;
  }

  emit(type: string, data: unknown): void {
    for (const cb of this.listeners.get(type) ?? []) {
      cb({ data: JSON.stringify(data) });
    }
  }
}

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

const batchBody = {
  version: 3,
  flags: {
    'new-checkout-flow': {
      value: true,
      reason: 'RULE_MATCH',
      ruleId: 'rule_pro_geo',
      bucket: 12,
      version: 3,
    },
    'pricing-page-v2': { value: false, reason: 'KILL_SWITCH_OFF', version: 3 },
  },
};

const makeFetch = (body: unknown = batchBody): FetchLike =>
  vi.fn(async () => jsonResponse(body)) as unknown as FetchLike;

describe('FlagForgeClient', () => {
  it('bootstraps from /v1/evaluate/batch', async () => {
    const fetchImpl = makeFetch();
    const client = await FlagForgeClient.create({
      apiUrl: 'http://api.test/',
      sdkKey: 'ff_test_key',
      userContext: { userId: 'u_1', attributes: { plan: 'pro' } },
      fetchImpl,
      stream: false,
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe('http://api.test/v1/evaluate/batch');
    expect(init.headers['x-sdk-key']).toBe('ff_test_key');
    expect(JSON.parse(init.body)).toEqual({
      userId: 'u_1',
      attributes: { plan: 'pro' },
    });

    expect(client.getFlag('new-checkout-flow')).toBe(true);
    expect(client.get('pricing-page-v2', true)).toBe(false);
    expect(client.get('missing', 'fallback')).toBe('fallback');
    expect(client.getSnapshot().version).toBe(3);
  });

  it('opens an SSE stream and applies live evaluated results', async () => {
    FakeEventSource.instances = [];
    const client = await FlagForgeClient.create({
      apiUrl: 'http://api.test',
      sdkKey: 'ff_test_key',
      userContext: { userId: 'u_1', attributes: { plan: 'pro', country: 'IN' } },
      fetchImpl: makeFetch(),
      eventSourceFactory: (url) => new FakeEventSource(url),
    });

    const source = FakeEventSource.instances[0]!;
    expect(source.url).toContain('/v1/stream?');
    expect(source.url).toContain('sdkKey=ff_test_key');
    expect(source.url).toContain('userId=u_1');
    expect(source.url).toContain('attributes=');

    const seen: boolean[] = [];
    client.subscribe((snapshot) => {
      seen.push(Boolean(snapshot.results['new-checkout-flow']?.value));
    });

    source.emit('flags', {
      version: 4,
      results: {
        'new-checkout-flow': { value: false, reason: 'DEFAULT_FALLBACK', version: 4 },
      },
    });

    expect(client.getFlag('new-checkout-flow')).toBe(false);
    expect(client.getSnapshot().version).toBe(4);
    expect(seen).toEqual([false]);
  });

  it('closes the stream and clears subscribers on close()', async () => {
    FakeEventSource.instances = [];
    const client = await FlagForgeClient.create({
      apiUrl: 'http://api.test',
      sdkKey: 'k',
      userContext: { userId: 'u' },
      fetchImpl: makeFetch(),
      eventSourceFactory: (url) => new FakeEventSource(url),
    });
    const listener = vi.fn();
    client.subscribe(listener);
    client.close();
    expect(FakeEventSource.instances[0]?.closed).toBe(true);
  });

  it('never rejects ready on HTTP failure and reports via onError', async () => {
    const onError = vi.fn();
    const fetchImpl = (async () =>
      jsonResponse({ error: 'nope' }, false, 500)) as unknown as FetchLike;

    const client = await FlagForgeClient.create({
      apiUrl: 'http://api.test',
      sdkKey: 'k',
      userContext: { userId: 'u' },
      fetchImpl,
      stream: false,
      onError,
    });

    expect(client.getFlag('anything')).toBeUndefined();
    expect(onError).toHaveBeenCalledOnce();
  });
});