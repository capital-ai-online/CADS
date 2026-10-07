import { performance } from 'node:perf_hooks';

const MAX_SAMPLES = 256;
const state = new Map();

function safePart(value, fallback = 'unknown') {
  const text = String(value || fallback).toLowerCase().replace(/[^a-z0-9_.:-]/g, '_');
  return text.slice(0, 80) || fallback;
}

export function classifyCadsError(error) {
  const code = String(error?.code || '').toUpperCase();
  const message = String(error?.message || error || '').toUpperCase();
  if (/AUTH|PERMISSION|DENIED|CREDENTIAL|TOKEN/.test(code + ' ' + message)) return 'AUTH';
  if (/TIMEOUT|ETIMEDOUT|DEADLINE/.test(code + ' ' + message)) return 'TIMEOUT';
  if (/ENOTFOUND|EAI_AGAIN|DNS/.test(code + ' ' + message)) return 'DNS';
  if (/ECONNREFUSED|ECONNRESET|DISCONNECT|UNAVAILABLE|NETWORK/.test(code + ' ' + message)) return 'CONNECTIVITY';
  if (/STREAM|JETSTREAM|ACK|EVIDENCE/.test(code + ' ' + message)) return 'STREAM_EVIDENCE';
  if (/REDIS|VALKEY|CACHE|PUBSUB/.test(code + ' ' + message)) return 'CACHE_PUBSUB';
  if (/INVALID|SCHEMA|VALIDATION|PARSE/.test(code + ' ' + message)) return 'DATA_VALIDATION';
  if (/SCORE|SCORER/.test(code + ' ' + message)) return 'SCORING';
  return 'UNKNOWN';
}

function record({ layer, service, operation, durationMs, outcome, errorClass = null }) {
  const key = [safePart(layer), safePart(service), safePart(operation)].join('|');
  const current = state.get(key) || { count: 0, errors: 0, totalMs: 0, maxMs: 0, samples: [], byError: {} };
  current.count += 1;
  current.errors += outcome === 'error' ? 1 : 0;
  current.totalMs += durationMs;
  current.maxMs = Math.max(current.maxMs, durationMs);
  current.samples.push(durationMs);
  if (current.samples.length > MAX_SAMPLES) current.samples.shift();
  if (errorClass) current.byError[errorClass] = (current.byError[errorClass] || 0) + 1;
  state.set(key, current);
}

export async function observeCadsOperation(meta, fn) {
  const started = performance.now();
  const base = {
    schema: 'CAPITAL_AI_CADS_EVENT@1',
    layer: safePart(meta.layer),
    service: safePart(meta.service),
    operation: safePart(meta.operation),
    correlationId: meta.correlationId ? safePart(meta.correlationId) : null,
  };
  try {
    const value = await fn();
    const durationMs = +(performance.now() - started).toFixed(3);
    record({ ...base, durationMs, outcome: 'ok' });
    console.log(JSON.stringify({ ...base, durationMs, outcome: 'ok' }));
    return value;
  } catch (error) {
    const durationMs = +(performance.now() - started).toFixed(3);
    const errorClass = classifyCadsError(error);
    record({ ...base, durationMs, outcome: 'error', errorClass });
    console.warn(JSON.stringify({ ...base, durationMs, outcome: 'error', errorClass }));
    throw error;
  }
}

function quantile(samples, q) {
  if (!samples.length) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q))];
}

export function cadsSnapshot() {
  return [...state.entries()].map(([key, value]) => {
    const [layer, service, operation] = key.split('|');
    return {
      layer, service, operation,
      count: value.count,
      errors: value.errors,
      errorRate: value.count ? value.errors / value.count : 0,
      avgMs: value.count ? +(value.totalMs / value.count).toFixed(3) : 0,
      p50Ms: +quantile(value.samples, 0.50).toFixed(3),
      p95Ms: +quantile(value.samples, 0.95).toFixed(3),
      p99Ms: +quantile(value.samples, 0.99).toFixed(3),
      maxMs: +value.maxMs.toFixed(3),
      errorClasses: { ...value.byError },
    };
  });
}

export function renderCadsPrometheusMetrics() {
  const lines = [
    '# HELP capital_ai_cads_operation_duration_ms CADS bounded operation latency.',
    '# TYPE capital_ai_cads_operation_duration_ms gauge',
    '# HELP capital_ai_cads_operation_errors_total CADS operation errors.',
    '# TYPE capital_ai_cads_operation_errors_total counter',
  ];
  for (const row of cadsSnapshot()) {
    const labels = `layer="${row.layer}",service="${row.service}",operation="${row.operation}"`;
    lines.push(`capital_ai_cads_operation_duration_ms{${labels},quantile="0.50"} ${row.p50Ms}`);
    lines.push(`capital_ai_cads_operation_duration_ms{${labels},quantile="0.95"} ${row.p95Ms}`);
    lines.push(`capital_ai_cads_operation_duration_ms{${labels},quantile="0.99"} ${row.p99Ms}`);
    lines.push(`capital_ai_cads_operation_errors_total{${labels}} ${row.errors}`);
  }
  return lines.join('\n') + (lines.length > 4 ? '\n' : '');
}

export function resetCadsForTests() {
  state.clear();
}
