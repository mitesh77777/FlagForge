import type { Redis } from 'ioredis';
import { REDIS_CHANNEL_FLAG_INVALIDATION } from '../config.js';

export interface InvalidationMessage {
  environmentId: string;
  flagKey: string;
  action: string;
  version: number;
  ts: number;
}

export type InvalidationHandler = (
  message: InvalidationMessage,
) => void | Promise<void>;

/**
 * Redis Pub/Sub invalidation bus.
 *
 * Publishers run after a control-plane commit and broadcast a small message.
 * Every API instance subscribes and reacts by purging its L1 cache (and, in the
 * app wiring, pushing the refreshed snapshot to its SSE clients).
 *
 * Pub/Sub is fire-and-forget: correctness never depends on a message arriving,
 * because the L2 entry is already updated and the L2 TTL bounds staleness. The
 * message is purely a low-latency optimisation.
 */
export class InvalidationBus {
  private handler: InvalidationHandler | null = null;
  private started = false;

  constructor(
    private readonly pub: Redis,
    private readonly sub: Redis,
    private readonly channel: string = REDIS_CHANNEL_FLAG_INVALIDATION,
    private readonly onError: (err: unknown) => void = () => {},
  ) {}

  async publish(
    message: Omit<InvalidationMessage, 'ts'> & { ts?: number },
  ): Promise<void> {
    const payload: InvalidationMessage = {
      ts: Date.now(),
      ...message,
    };
    await this.pub.publish(this.channel, JSON.stringify(payload));
  }

  async start(handler: InvalidationHandler): Promise<void> {
    this.handler = handler;
    this.sub.on('message', (channel: string, payload: string) => {
      if (channel !== this.channel) return;
      void this.dispatch(payload);
    });
    this.sub.on('error', (err: unknown) => this.onError(err));
    await this.sub.subscribe(this.channel);
    this.started = true;
  }

  private async dispatch(payload: string): Promise<void> {
    if (!this.handler) return;
    try {
      const message = JSON.parse(payload) as InvalidationMessage;
      await this.handler(message);
    } catch (err) {
      this.onError(err);
    }
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    try {
      await this.sub.unsubscribe(this.channel);
    } catch (err) {
      this.onError(err);
    }
  }

  get channelName(): string {
    return this.channel;
  }
}
