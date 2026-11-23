import { randomUUID } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import type { EvaluationContext } from '@flagforge/evaluator';

interface SseClient {
  id: string;
  environmentId: string;
  res: ServerResponse;
  /** Present when the client asked to receive pre-evaluated results. */
  context?: EvaluationContext;
}

/**
 * A tiny Server-Sent Events hub. Each connected SDK/consumer registers against
 * one environment; when an invalidation arrives we push the fresh snapshot to
 * every matching client — zero polling.
 *
 * Clients that supply a `context` (userId + attributes) receive *evaluated*
 * results, so a dependency-free browser SDK never has to run the rule engine.
 * Clients without a context receive the raw flag config.
 */
export class SseHub {
  private readonly clients = new Map<string, SseClient>();

  add(
    environmentId: string,
    res: ServerResponse,
    context?: EvaluationContext,
  ): string {
    const id = randomUUID();
    this.clients.set(id, { id, environmentId, res, context });
    return id;
  }

  remove(id: string): void {
    this.clients.delete(id);
  }

  send(clientId: string, event: string, data: unknown): void {
    const client = this.clients.get(clientId);
    if (!client) return;
    this.write(client, event, data);
  }

  broadcast(environmentId: string, event: string, data: unknown): number {
    let delivered = 0;
    for (const client of this.clients.values()) {
      if (client.environmentId !== environmentId) continue;
      this.write(client, event, data);
      delivered += 1;
    }
    return delivered;
  }

  /**
   * Broadcast a per-client payload. `build` receives each client's evaluation
   * context (or `undefined` for config-only clients) and returns the data frame.
   */
  broadcastEach(
    environmentId: string,
    event: string,
    build: (context: EvaluationContext | undefined) => unknown,
  ): number {
    let delivered = 0;
    for (const client of this.clients.values()) {
      if (client.environmentId !== environmentId) continue;
      this.write(client, event, build(client.context));
      delivered += 1;
    }
    return delivered;
  }

  /** Keep-alive comment frame, so proxies don't reap idle connections. */
  heartbeat(): void {
    for (const client of this.clients.values()) {
      try {
        client.res.write(': ping\n\n');
      } catch {
        this.clients.delete(client.id);
      }
    }
  }

  countForEnvironment(environmentId: string): number {
    let n = 0;
    for (const client of this.clients.values()) {
      if (client.environmentId === environmentId) n += 1;
    }
    return n;
  }

  get size(): number {
    return this.clients.size;
  }

  /**
   * Close every stream. When `reason` is supplied, clients first receive a
   * `retry:` hint and a final `shutdown` event, so the browser EventSource
   * reconnects promptly (to whichever instance is still serving) instead of
   * treating the close as a fatal error.
   */
  closeAll(reason?: string): void {
    for (const client of this.clients.values()) {
      try {
        if (reason) {
          client.res.write('retry: 1000\n\n');
          client.res.write(
            `event: shutdown\ndata: ${JSON.stringify({ reason })}\n\n`,
          );
        }
        client.res.end();
      } catch {
        /* ignore */
      }
    }
    this.clients.clear();
  }

  private write(client: SseClient, event: string, data: unknown): void {
    try {
      client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      this.clients.delete(client.id);
    }
  }
}