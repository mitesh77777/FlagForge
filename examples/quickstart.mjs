#!/usr/bin/env node
/**
 * FlagForge consumer example — what a *real* integrating developer writes.
 * ─────────────────────────────────────────────────────────────────────────────
 * This is an ordinary Node process that knows nothing about FlagForge internals.
 * It only has:
 *   • an API URL
 *   • an SDK key (from Dashboard → SDK & Keys)
 *   • a user id and attributes
 *
 * Run it, then flip the flag in the dashboard: the value here changes within a
 * frame, with no polling and no redeploy.
 *
 *   node examples/quickstart.mjs            # watch for live changes
 *   node examples/quickstart.mjs --once     # evaluate once and exit
 *
 * Env overrides:
 *   FLAGFORGE_API_URL   default http://localhost:8080
 *   FLAGFORGE_SDK_KEY   default the public demo key
 *   FLAGFORGE_FLAG      default new-checkout-flow
 *   FLAGFORGE_USER      default user_demo_001
 */
import { FlagForgeClient } from '../packages/sdk/dist/index.js';

const API_URL = (
  process.env.FLAGFORGE_API_URL ?? 'http://localhost:8080'
).replace(/\/+$/, '');
const SDK_KEY =
  process.env.FLAGFORGE_SDK_KEY ?? 'ff_live_demo_7f3a91c4e8b25d60';
const FLAG = process.env.FLAGFORGE_FLAG ?? 'new-checkout-flow';
const USER = process.env.FLAGFORGE_USER ?? 'user_demo_001';
const ONCE = process.argv.includes('--once');

const ATTRIBUTES = {
  plan: 'pro',
  country: 'IN',
  appVersion: '2.4.1',
  betaOptIn: false,
  emailDomain: 'acme.io',
  seats: 12,
};

// ── A minimal Server-Sent Events client ──────────────────────────────────────
// Node has no global EventSource, so we speak the wire protocol directly. This
// is also the clearest documentation of what the stream sends.

function makeEventSource(url) {
  const listeners = new Map();
  const controller = new AbortController();

  const emit = (type, data) => {
    for (const listener of listeners.get(type) ?? []) listener({ data });
  };

  void (async () => {
    try {
      const response = await fetch(url, {
        headers: { accept: 'text/event-stream' },
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        emit('error', JSON.stringify({ status: response.status }));
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let separator = buffer.indexOf('\n\n');
        while (separator !== -1) {
          const frame = buffer.slice(0, separator);
          buffer = buffer.slice(separator + 2);
          separator = buffer.indexOf('\n\n');

          let event = 'message';
          const dataLines = [];
          for (const rawLine of frame.split('\n')) {
            const part = rawLine.replace(/\r$/, '');
            if (part.startsWith('event:')) event = part.slice(6).trim();
            else if (part.startsWith('data:')) dataLines.push(part.slice(5).trim());
            // `:` comments are heartbeats — deliberately ignored.
          }
          if (dataLines.length > 0) emit(event, dataLines.join('\n'));
        }
      }
    } catch (error) {
      if (error?.name !== 'AbortError') {
        emit('error', JSON.stringify({ message: String(error?.message ?? error) }));
      }
    }
  })();

  return {
    addEventListener(type, listener) {
      const list = listeners.get(type) ?? [];
      list.push(listener);
      listeners.set(type, list);
    },
    close() {
      controller.abort();
    },
  };
}

// ── Reporting ────────────────────────────────────────────────────────────────

const print = (label, value) => console.log(`  ${label.padEnd(10)} ${value}`);

let lastValue;

function report(snapshot, label) {
  const result = snapshot.results?.[FLAG];
  console.log(`\n── ${label} · config v${snapshot.version} ──────────────────`);
  if (!result) {
    print('result', `${FLAG} was not returned`);
    return;
  }
  print('flag', FLAG);
  print('user', `${USER} (${ATTRIBUTES.plan}, ${ATTRIBUTES.country})`);
  print('value', String(result.value));
  print('reason', result.reason);
  print(
    'bucket',
    result.bucket === null || result.bucket === undefined
      ? '— (no bucketing on this path)'
      : `${result.bucket} / 100`,
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

console.log('FlagForge consumer example');
print('api', API_URL);
print('key', `${SDK_KEY.slice(0, 16)}…`);
print('mode', ONCE ? 'single evaluation' : 'watch for live updates');

const client = new FlagForgeClient({
  apiUrl: API_URL,
  sdkKey: SDK_KEY,
  userContext: { userId: USER, attributes: ATTRIBUTES },
  eventSourceFactory: makeEventSource,
  onError: (error) => {
    console.error(
      '\n  [sdk] error:',
      error instanceof Error ? error.message : String(error),
    );
  },
});

try {
  const snapshot = await client.ready;
  report(snapshot, 'initial evaluation (bootstrap call)');
  lastValue = snapshot.results?.[FLAG]?.value;

  if (ONCE) {
    client.close();
    process.exit(0);
  }

  client.onChange((next) => {
    const value = next.results?.[FLAG]?.value;
    if (value === lastValue) return; // ignore version bumps that don't change this flag
    lastValue = value;
    report(next, 'LIVE UPDATE — pushed over SSE');
  });

  console.log(
    '\nListening on the SSE stream. Flip this flag in the dashboard and watch it change here.\nCtrl+C to stop.\n',
  );
} catch (error) {
  console.error(
    '\nCould not reach the API. Is it running, and is the SDK key valid?\n',
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
}
