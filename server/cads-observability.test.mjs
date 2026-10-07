import test from 'node:test';
import assert from 'node:assert/strict';
import { observeCadsOperation, cadsSnapshot, classifyCadsError, renderCadsPrometheusMetrics, resetCadsForTests } from './cads-observability.mjs';

test('CADS records successful operation latency without payload data', async () => {
  resetCadsForTests();
  const value = await observeCadsOperation({ layer:'stream', service:'nats', operation:'publish', correlationId:'abc-1' }, async () => 42);
  assert.equal(value, 42);
  const row = cadsSnapshot()[0];
  assert.equal(row.layer, 'stream');
  assert.equal(row.service, 'nats');
  assert.equal(row.operation, 'publish');
  assert.equal(row.errors, 0);
  assert.match(renderCadsPrometheusMetrics(), /capital_ai_cads_operation_duration_ms/);
});

test('CADS classifies auth and network failures without serializing error payloads', async () => {
  resetCadsForTests();
  await assert.rejects(
    observeCadsOperation({ layer:'network', service:'nats', operation:'connect' }, async () => {
      const e = new Error('authentication violation'); e.code = 'AUTHORIZATION_VIOLATION'; throw e;
    })
  );
  const row = cadsSnapshot()[0];
  assert.equal(row.errors, 1);
  assert.equal(row.errorClasses.AUTH, 1);
  assert.equal(classifyCadsError(Object.assign(new Error('connect refused'), { code:'ECONNREFUSED' })), 'CONNECTIVITY');
});
