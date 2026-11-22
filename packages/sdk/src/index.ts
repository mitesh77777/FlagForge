/**
 * @flagforge/sdk — a tiny, dependency-free client SDK.
 *
 * Usage:
 *   const client = await FlagForgeClient.create({
 *     apiUrl: 'http://localhost:8080',
 *     sdkKey: 'ff_live_...',
 *     userContext: { userId: 'u_123', attributes: { plan: 'pro' } },
 *   });
 *   client.getFlag('new-checkout-flow'); // true | false | variant
 *
 * Live updates arrive over SSE with pre-evaluated results for this user, so the
 * SDK does not need to bundle the rule engine.
 */

export type AttributeValue = string | number | boolean;

export interface UserContext {
  userId: string;
  attributes?: Record<string, AttributeValue>;
}

export interface FlagResult {
  value: unknown;
  reason: string;
  ruleId?: string | null;
  bucket?: number | null;
  version: number;
}

export interface FlagSnapshot {
  version: number;
  results: Record<string, FlagResult>;
}

export type SnapshotListener = (snapshot: FlagSnapshot) => void;

export interface FetchResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<FetchResponseLike>;

export interface EventSourceLike {
  addEventListener(type: string, listener: (event: { data: string }) => void): void;
  close(): void;
}

export type EventSourceFactory = (url: string) => EventSourceLike;

export interface FlagForgeOptions {
  apiUrl: string;
  sdkKey: string;
  userContext: UserContext;
  /** Override for tests / non-standard runtimes. */
  fetchImpl?: FetchLike;
  /** Override for tests / server-side rendering. */
  eventSourceFactory?: EventSourceFactory;
  /** Disable the SSE connection (initial batch only). Defaults to true. */
  stream?: boolean;
  onError?: (error: unknown) => void;
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

function defaultFetch(): FetchLike {
  if (typeof fetch !== 'function') {
    throw new Error('FlagForge: no global fetch; provide options.fetchImpl');
  }
  return (input, init) =>
    fetch(input, init as RequestInit) as unknown as Promise<FetchResponseLike>;
}

function defaultEventSourceFactory(): EventSourceFactory | null {
  const Ctor = (
    globalThis as unknown as {
      EventSource?: new (url: string) => EventSourceLike;
    }
  ).EventSource;
  return Ctor ? (url: string) => new Ctor(url) : null;
}

interface BatchPayload {
  version?: number;
  flags?: Record<string, FlagResult>;
}

interface StreamPayload {
  version?: number;
  results?: Record<string, FlagResult>;
  flags?: unknown;
}

export class FlagForgeClient {
  private snapshot: FlagSnapshot = { version: 0, results: {} };
  private readonly listeners = new Set<SnapshotListener>();
  private readonly fetchImpl: FetchLike;
  private readonly eventSourceFactory: EventSourceFactory | null;
  private eventSource: EventSourceLike | null = null;
  private closed = false;

  /** Resolves once the initial batch has loaded (never rejects). */
  readonly ready: Promise<FlagSnapshot>;

  constructor(private readonly options: FlagForgeOptions) {
    this.fetchImpl = options.fetchImpl ?? defaultFetch();
    this.eventSourceFactory =
      options.stream === false
        ? null
        : (options.eventSourceFactory ?? defaultEventSourceFactory());

    this.ready = this.bootstrap().catch((error: unknown) => {
      this.reportError(error);
      return this.snapshot;
    });
  }

  static async create(options: FlagForgeOptions): Promise<FlagForgeClient> {
    const client = new FlagForgeClient(options);
    await client.ready;
    return client;
  }

  private async bootstrap(): Promise<FlagSnapshot> {
    await this.refresh();
    this.connect();
    return this.snapshot;
  }

  /** Re-fetch evaluated flags for this user from `/v1/evaluate/batch`. */
  async refresh(): Promise<FlagSnapshot> {
    const res = await this.fetchImpl(
      `${trimTrailingSlash(this.options.apiUrl)}/v1/evaluate/batch`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-sdk-key': this.options.sdkKey,
        },
        body: JSON.stringify({
          userId: this.options.userContext.userId,
          attributes: this.options.userContext.attributes ?? {},
        }),
      },
    );

    if (!res.ok) {
      throw new Error(`FlagForge: batch request failed with HTTP ${res.status}`);
    }

    const data = (await res.json()) as BatchPayload;
    if (!data || typeof data !== 'object' || !data.flags) {
      throw new Error('FlagForge: malformed batch response');
    }

    this.setSnapshot({
      version: data.version ?? 0,
      results: data.flags,
    });
    return this.snapshot;
  }

  private connect(): void {
    if (!this.eventSourceFactory || this.closed) return;

    const params = new URLSearchParams({
      sdkKey: this.options.sdkKey,
      userId: this.options.userContext.userId,
    });
    const attributes = this.options.userContext.attributes;
    if (attributes && Object.keys(attributes).length > 0) {
      params.set('attributes', JSON.stringify(attributes));
    }

    const source = this.eventSourceFactory(
      `${trimTrailingSlash(this.options.apiUrl)}/v1/stream?${params.toString()}`,
    );

    source.addEventListener('flags', (event) => {
      try {
        const payload = JSON.parse(event.data) as StreamPayload;
        if (payload.results) {
          this.setSnapshot({
            version: payload.version ?? this.snapshot.version,
            results: payload.results,
          });
        } else {
          // A config-only frame (e.g. no user context on the stream) —
          // re-evaluate for this user rather than trying to bucket client-side.
          void this.refresh().catch((error: unknown) => this.reportError(error));
        }
      } catch (error) {
        this.reportError(error);
      }
    });

    this.eventSource = source;
  }

  /** Subscribe to every snapshot change. Returns an unsubscribe function. */
  subscribe(listener: SnapshotListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Alias for `subscribe` for ergonomic event-style usage. */
  onChange(listener: SnapshotListener): () => void {
    return this.subscribe(listener);
  }

  getSnapshot(): FlagSnapshot {
    return this.snapshot;
  }

  getResult(key: string): FlagResult | undefined {
    return this.snapshot.results[key];
  }

  /** Raw value or `undefined` when the flag is unknown. */
  getFlag(key: string): unknown {
    return this.snapshot.results[key]?.value;
  }

  /** Typed value with a fallback. */
  get<T>(key: string, fallback: T): T {
    const value = this.getFlag(key);
    return value === undefined ? fallback : (value as T);
  }

  close(): void {
    this.closed = true;
    this.eventSource?.close();
    this.eventSource = null;
    this.listeners.clear();
  }

  private setSnapshot(snapshot: FlagSnapshot): void {
    this.snapshot = snapshot;
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch (error) {
        this.reportError(error);
      }
    }
  }

  private reportError(error: unknown): void {
    this.options.onError?.(error);
  }
}