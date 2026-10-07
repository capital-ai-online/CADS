import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { CADS_TIERS } from '../packages/cads-core/index.mjs';

const manifest = JSON.parse(readFileSync(
  new URL('../apps/cads-github-app/marketplace-plans.production.json', import.meta.url),
  'utf8',
));
const registration = JSON.parse(readFileSync(
  new URL('../apps/cads-github-app/github-app-registration.production.example.json', import.meta.url),
  'utf8',
));

test('production Marketplace exposes paid Starter Pro Enterprise only', () => {
  assert.equal(manifest.strategy, 'PAID_PRODUCTION');
  assert.equal(manifest.currency, 'USD');
  assert.equal(manifest.freePlanEnabled, false);
  assert.equal(manifest.audience, 'B2B');
  assert.deepEqual(manifest.plans.map(plan => plan.id), ['starter', 'pro', 'enterprise']);
  for (const plan of manifest.plans) {
    assert.equal(plan.priceModel, 'FLAT_RATE');
    assert.deepEqual(plan.billing, ['monthly', 'yearly']);
    assert.equal(plan.availableFor, 'ORGANIZATIONS_ONLY');
    assert.equal(plan.freeTrialEnabled, false);
  }
});

test('Marketplace plan capabilities cannot drift from canonical CADS tiers', () => {
  for (const plan of manifest.plans) {
    assert.deepEqual(plan.capabilities, CADS_TIERS[plan.id].capabilities);
  }
});

test('production manifest never invents USD price values', () => {
  assert.equal(manifest.priceValues.state, 'OWNER_INPUT_REQUIRED_IN_GITHUB_MARKETPLACE');
  assert.equal(JSON.stringify(manifest).includes('monthlyUsd'), false);
  assert.equal(JSON.stringify(manifest).includes('annualUsd'), false);
});

test('production GitHub App registration routes installation through verified user linking', () => {
  assert.equal(registration.public, true);
  assert.equal(registration.request_oauth_on_install, false);
  assert.equal(registration.setup_url, 'https://capital-ai.online/api/cads/marketplace/setup');
  assert.deepEqual(registration.callback_urls, [
    'https://capital-ai.online/api/cads/marketplace/oauth/callback',
  ]);
  assert.equal(registration.hook_url, 'https://capital-ai.online/api/integrations/github/cads-marketplace');
  assert.deepEqual(registration.permissions, {
    metadata: 'read',
    contents: 'read',
    pull_requests: 'read',
    checks: 'write',
  });
});
