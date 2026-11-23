import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from 'prom-client';

/** Values sampled lazily at scrape time, so they always reflect live state. */
export interface MetricGauges {
  sseClients: () => number;
  inflightLoads: () => number;
  coalescedLoads: () => number;
}

/**
 * Prometheus instrumentation for the API.
 *
 * Everything here is derived from real request traffic: HTTP latency comes from
 * Fastify's `onResponse` hook, the cache-tier counters are read from the
 * `X-Cache-Status` response header the data plane already sets, and the gauges
 * are computed at scrape time. No route needs to know that metrics exist.
 */
export function createMetrics(gauges: MetricGauges) {
  const registry = new Registry();
  registry.setDefaultLabels({ app: 'flagforge-api' });
  collectDefaultMetrics({ register: registry });

  const httpDuration = new Histogram({
    name: 'flagforge_http_request_duration_seconds',
    help: 'HTTP request duration in seconds, by method, route and status.',
    labelNames: ['method', 'route', 'status'] as const,
    buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [registry],
  });

  const cacheLookups = new Counter({
    name: 'flagforge_cache_lookups_total',
    help: 'Snapshot resolutions by cache tier.',
    labelNames: ['tier'] as const,
    registers: [registry],
  });

  const snapshotLoads = new Counter({
    name: 'flagforge_snapshot_loads_total',
    help: 'Cold snapshot loads, split by whether the caller coalesced onto another load.',
    labelNames: ['cause'] as const,
    registers: [registry],
  });

  const invalidations = new Counter({
    name: 'flagforge_invalidations_total',
    help: 'Cache invalidations applied from the Pub/Sub bus.',
    labelNames: ['action'] as const,
    registers: [registry],
  });

  const aiCompiles = new Counter({
    name: 'flagforge_ai_compiles_total',
    help: 'AI rule compilations by source.',
    labelNames: ['source'] as const,
    registers: [registry],
  });

  const readinessChecks = new Counter({
    name: 'flagforge_readiness_checks_total',
    help: 'Readiness probe outcomes per dependency.',
    labelNames: ['check', 'result'] as const,
    registers: [registry],
  });

  const sseClients = new Gauge({
    name: 'flagforge_sse_clients',
    help: 'Currently connected SSE clients.',
    registers: [registry],
    collect() {
      this.set(gauges.sseClients());
    },
  });

  const inflightLoads = new Gauge({
    name: 'flagforge_inflight_snapshot_loads',
    help: 'Snapshot loads currently in flight (distinct environments).',
    registers: [registry],
    collect() {
      this.set(gauges.inflightLoads());
    },
  });

  const coalescedLoads = new Gauge({
    name: 'flagforge_coalesced_snapshot_loads_total',
    help: 'Cumulative callers that joined an in-flight snapshot load.',
    registers: [registry],
    collect() {
      this.set(gauges.coalescedLoads());
    },
  });

  return {
    registry,
    httpDuration,
    cacheLookups,
    snapshotLoads,
    invalidations,
    aiCompiles,
    readinessChecks,
    sseClients,
    inflightLoads,
    coalescedLoads,
  };
}

export type Metrics = ReturnType<typeof createMetrics>;
