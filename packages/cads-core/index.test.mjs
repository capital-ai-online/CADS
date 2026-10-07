import assert from 'node:assert/strict';
import test from 'node:test';
import { CADS_TIERS, cadsEntitlementForTier } from './index.mjs';

test('CADS tiers are Starter Pro Enterprise with fail-closed lookup', () => {
  assert.deepEqual(Object.keys(CADS_TIERS), ['starter', 'pro', 'enterprise']);
  assert.equal(cadsEntitlementForTier('starter').capabilities.history, false);
  assert.equal(cadsEntitlementForTier('pro').capabilities.evidenceExport, true);
  assert.equal(cadsEntitlementForTier('enterprise').capabilities.enforcedPrGate, true);
  assert.throws(() => cadsEntitlementForTier('unknown'), /UNSUPPORTED_CADS_TIER/);
});

test('tier capabilities contain no event-backbone implementation claims', () => {
  const serialized = JSON.stringify(CADS_TIERS).toLowerCase();
  for (const forbidden of ['nats', 'kafka', 'golang', '"rust"']) {
    assert.equal(serialized.includes(forbidden), false);
  }
});
