import assert from 'node:assert/strict';
import { createHmac, generateKeyPairSync } from 'node:crypto';
import { Readable } from 'node:stream';
import test from 'node:test';
import {
  cadsMarketplaceConfig,
  createCadsMarketplace,
  publicCadsMarketplaceReadiness,
  tierForMarketplacePlanId,
} from './cads-marketplace.mjs';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' });

function baseEnv() {
  return {
    CADS_GITHUB_APP_ID: '12345',
    CADS_GITHUB_APP_PRIVATE_KEY: PRIVATE_KEY,
    CADS_GITHUB_MARKETPLACE_WEBHOOK_SECRET: 'x'.repeat(48),
    CADS_GITHUB_MARKETPLACE_OWNER_ORG: 'capital-ai-online',
    CADS_GITHUB_MARKETPLACE_LISTING_SLUG: 'capital-ai-cads',
    CADS_GITHUB_CLIENT_ID: 'Iv1.cads-example',
    CADS_GITHUB_CLIENT_SECRET: 'client-secret-' + 'x'.repeat(32),
    CADS_GITHUB_OAUTH_STATE_SECRET: 'state-secret-' + 'x'.repeat(32),
    CADS_GITHUB_PUBLIC_URL: 'https://capital-ai.online',
    CADS_GITHUB_MARKETPLACE_STARTER_PLAN_ID: '1001',
    CADS_GITHUB_MARKETPLACE_PRO_PLAN_ID: '1002',
    CADS_GITHUB_MARKETPLACE_ENTERPRISE_PLAN_ID: '1003',
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_SECRET_KEY: 'sb_secret_' + 'x'.repeat(40),
  };
}

test('paid Marketplace runtime requires app, distinct plan IDs and service-role store', () => {
  const ready = publicCadsMarketplaceReadiness(baseEnv());
  assert.equal(ready.target, 'PAID_PRODUCTION');
  assert.deepEqual(ready.plans, ['starter', 'pro', 'enterprise']);
  assert.equal(ready.pricingCurrency, 'USD');
  assert.equal(ready.monthlyAndAnnualRequired, true);
  assert.equal(ready.freePlanEnabled, false);
  assert.equal(ready.appConfigured, true);
  assert.equal(ready.buyerLinkConfigured, true);
  assert.equal(ready.planIdsConfigured, true);
  assert.equal(ready.entitlementStoreConfigured, true);
  assert.equal(ready.runtimeReady, true);

  const broken = baseEnv();
  broken.CADS_GITHUB_MARKETPLACE_PRO_PLAN_ID = '1001';
  assert.equal(cadsMarketplaceConfig(broken).runtimeReady, false);
});

test('Marketplace plan IDs map only to canonical CADS tiers', () => {
  const env = baseEnv();
  assert.equal(tierForMarketplacePlanId(1001, env), 'starter');
  assert.equal(tierForMarketplacePlanId(1002, env), 'pro');
  assert.equal(tierForMarketplacePlanId(1003, env), 'enterprise');
  assert.equal(tierForMarketplacePlanId(9999, env), null);
});

test('readiness exposes no secrets or concrete plan IDs', () => {
  const payload = JSON.stringify(publicCadsMarketplaceReadiness(baseEnv()));
  assert.equal(payload.includes(PRIVATE_KEY), false);
  assert.equal(payload.includes('1001'), false);
  assert.equal(payload.includes('sb_secret_'), false);
});

test('cleanup is fail-closed when the entitlement store is absent', async () => {
  const env = baseEnv();
  delete env.SUPABASE_SECRET_KEY;
  const marketplace = createCadsMarketplace({ env, fetchImpl: async () => { throw new Error('must not fetch'); } });
  assert.deepEqual(await marketplace.purgeCancelledData(), { configured: false });
});

function webhookRequest(payload, secret, headers = {}) {
  const raw = Buffer.from(JSON.stringify(payload));
  const req = Readable.from([raw]);
  req.method = 'POST';
  req.headers = {
    'content-type': 'application/json',
    'x-github-event': 'marketplace_purchase',
    'x-github-delivery': '11111111-2222-3333-4444-555555555555',
    'x-hub-signature-256': 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex'),
    ...headers,
  };
  return req;
}

function responseHarness() {
  return { setHeader() {} };
}

test('paid purchase is applied only after authoritative GitHub Marketplace readback', async () => {
  const env = baseEnv();
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).startsWith('https://api.github.com/marketplace_listing/accounts/42')) {
      return new Response(JSON.stringify({ id: 42, login: 'acme', type: 'Organization', marketplace_purchase: { plan: { id: 1002 } } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (String(url).includes('/rest/v1/rpc/capital_ai_apply_cads_marketplace_purchase')) {
      return new Response(JSON.stringify({ duplicate: false, status: 'ACTIVE', tier: 'pro' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error('unexpected fetch ' + url);
  };
  const marketplace = createCadsMarketplace({ env, fetchImpl });
  const req = webhookRequest({
    action: 'purchased',
    marketplace_purchase: {
      account: { id: 42, login: 'acme', type: 'Organization' },
      plan: { id: 1002, name: 'Pro' },
    },
    effective_date: '2026-10-06T19:30:00Z',
  }, env.CADS_GITHUB_MARKETPLACE_WEBHOOK_SECRET);

  let status = 0;
  let payload = null;
  const handled = await marketplace.handle(
    req,
    responseHarness(),
    new URL('https://capital-ai.online/api/integrations/github/cads-marketplace'),
    (_res, nextStatus, nextPayload) => { status = nextStatus; payload = nextPayload; },
  );

  assert.equal(handled, true);
  assert.equal(status, 200);
  assert.equal(payload.tier, 'pro');
  assert.equal(payload.billingAuthority, 'GITHUB_MARKETPLACE');
  assert.equal(payload.capabilities.evidenceExport, true);
  assert.equal(calls.length, 2);
  const rpcBody = JSON.parse(calls[1].options.body);
  assert.equal(rpcBody._tier, 'pro');
  assert.equal(rpcBody._marketplace_plan_id, 1002);
  assert.equal(rpcBody._account_id, 42);
});

test('plan change fails closed when GitHub readback disagrees with webhook plan', async () => {
  const env = baseEnv();
  const fetchImpl = async (url) => {
    if (String(url).startsWith('https://api.github.com/marketplace_listing/accounts/42')) {
      return new Response(JSON.stringify({ id: 42, login: 'acme', type: 'Organization', marketplace_purchase: { plan: { id: 1003 } } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error('store must not be reached');
  };
  const marketplace = createCadsMarketplace({ env, fetchImpl });
  const req = webhookRequest({
    action: 'changed',
    marketplace_purchase: {
      account: { id: 42, login: 'acme', type: 'Organization' },
      plan: { id: 1002, name: 'Pro' },
    },
  }, env.CADS_GITHUB_MARKETPLACE_WEBHOOK_SECRET);

  let status = 0;
  let payload = null;
  await marketplace.handle(
    req,
    responseHarness(),
    new URL('https://capital-ai.online/api/integrations/github/cads-marketplace'),
    (_res, nextStatus, nextPayload) => { status = nextStatus; payload = nextPayload; },
  );
  assert.equal(status, 409);
  assert.equal(payload.error, 'marketplace_readback_mismatch');
});

test('cancellation revokes the mapped tier without trusting Stripe', async () => {
  const env = baseEnv();
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('/rest/v1/rpc/capital_ai_apply_cads_marketplace_purchase')) {
      return new Response(JSON.stringify({ duplicate: false, status: 'CANCELLED', tier: 'enterprise' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error('unexpected fetch ' + url);
  };
  const marketplace = createCadsMarketplace({ env, fetchImpl });
  const req = webhookRequest({
    action: 'cancelled',
    marketplace_purchase: {
      account: { id: 42, login: 'acme', type: 'Organization' },
      plan: { id: 1003, name: 'Enterprise' },
    },
    effective_date: '2026-11-06T00:00:00Z',
  }, env.CADS_GITHUB_MARKETPLACE_WEBHOOK_SECRET);

  let status = 0;
  let payload = null;
  await marketplace.handle(
    req,
    responseHarness(),
    new URL('https://capital-ai.online/api/integrations/github/cads-marketplace'),
    (_res, nextStatus, nextPayload) => { status = nextStatus; payload = nextPayload; },
  );
  assert.equal(status, 200);
  assert.equal(payload.action, 'cancelled');
  assert.equal(payload.tier, 'enterprise');
  assert.equal(calls.length, 1);
});

test('invalid webhook signature is rejected before GitHub or Supabase access', async () => {
  const env = baseEnv();
  let fetched = false;
  const marketplace = createCadsMarketplace({
    env,
    fetchImpl: async () => { fetched = true; throw new Error('must not fetch'); },
  });
  const req = webhookRequest({
    action: 'purchased',
    marketplace_purchase: {
      account: { id: 42, login: 'acme', type: 'Organization' },
      plan: { id: 1001, name: 'Starter' },
    },
  }, 'wrong-secret-that-is-long-enough-for-the-test');

  let status = 0;
  let payload = null;
  await marketplace.handle(
    req,
    responseHarness(),
    new URL('https://capital-ai.online/api/integrations/github/cads-marketplace'),
    (_res, nextStatus, nextPayload) => { status = nextStatus; payload = nextPayload; },
  );
  assert.equal(status, 401);
  assert.equal(payload.error, 'invalid_webhook_signature');
  assert.equal(fetched, false);
});

function redirectHarness() {
  return {
    status: 0,
    headers: {},
    ended: false,
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    writeHead(status, headers = {}) {
      this.status = status;
      for (const [name, value] of Object.entries(headers)) this.headers[String(name).toLowerCase()] = value;
    },
    end() { this.ended = true; },
  };
}

test('setup binds installation to authenticated CAPITAL-AI user before GitHub OAuth', async () => {
  const env = baseEnv();
  const auth = { verify: async () => ({ userId: '00000000-0000-4000-8000-000000000001' }) };
  const marketplace = createCadsMarketplace({ env, auth });
  const req = { method: 'GET', headers: {} };
  const res = redirectHarness();
  const handled = await marketplace.handle(
    req,
    res,
    new URL('https://capital-ai.online/api/cads/marketplace/setup?installation_id=77&marketplace_listing_plan_id=999999'),
    () => { throw new Error('json response not expected'); },
  );
  assert.equal(handled, true);
  assert.equal(res.status, 302);
  const location = new URL(res.headers.location);
  assert.equal(location.origin + location.pathname, 'https://github.com/login/oauth/authorize');
  assert.equal(location.searchParams.get('client_id'), env.CADS_GITHUB_CLIENT_ID);
  assert.ok(location.searchParams.get('state'));
  assert.match(String(res.headers['set-cookie']), /^cads_marketplace_oauth_state=/);
  assert.equal(location.searchParams.has('marketplace_listing_plan_id'), false);
});

test('OAuth callback verifies user installation, Marketplace subscription and links Supabase user', async () => {
  const env = baseEnv();
  const userId = '00000000-0000-4000-8000-000000000001';
  const auth = { verify: async () => ({ userId }) };
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url) === 'https://github.com/login/oauth/access_token') {
      return new Response(JSON.stringify({ access_token: 'github-user-token' }), { status: 200 });
    }
    if (String(url).startsWith('https://api.github.com/user/installations')) {
      return new Response(JSON.stringify({
        installations: [{ id: 77, account: { id: 42, login: 'acme', type: 'Organization' } }],
      }), { status: 200 });
    }
    if (String(url).startsWith('https://api.github.com/marketplace_listing/accounts/42')) {
      return new Response(JSON.stringify({ id: 42, login: 'acme', type: 'Organization', marketplace_purchase: { plan: { id: 1002 } } }), { status: 200 });
    }
    if (String(url).startsWith('https://api.github.com/applications/') && options.method === 'DELETE') {
      return new Response(null, { status: 204 });
    }
    if (String(url).includes('/rest/v1/rpc/capital_ai_link_cads_marketplace_user')) {
      return new Response(JSON.stringify({ linked: true, accountId: 42, tier: 'pro' }), { status: 200 });
    }
    throw new Error('unexpected fetch ' + url);
  };
  const marketplace = createCadsMarketplace({ env, auth, fetchImpl });

  const setupReq = { method: 'GET', headers: {} };
  const setupRes = redirectHarness();
  await marketplace.handle(
    setupReq,
    setupRes,
    new URL('https://capital-ai.online/api/cads/marketplace/setup?installation_id=77'),
    () => { throw new Error('json response not expected'); },
  );
  const authorize = new URL(setupRes.headers.location);
  const state = authorize.searchParams.get('state');
  const cookie = String(setupRes.headers['set-cookie']).split(';')[0];

  const callbackReq = { method: 'GET', headers: { cookie } };
  const callbackRes = redirectHarness();
  await marketplace.handle(
    callbackReq,
    callbackRes,
    new URL('https://capital-ai.online/api/cads/marketplace/oauth/callback?code=oauth-code&state=' + encodeURIComponent(state)),
    (_res, status, payload) => { throw new Error('unexpected json ' + status + ' ' + JSON.stringify(payload)); },
  );
  assert.equal(callbackRes.status, 303);
  assert.equal(callbackRes.headers.location, '/profile?cads_marketplace=linked');
  const revokeIndex = calls.findIndex(call => call.url.startsWith('https://api.github.com/applications/') && call.options.method === 'DELETE');
  const linkIndex = calls.findIndex(call => call.url.includes('capital_ai_link_cads_marketplace_user'));
  assert.ok(revokeIndex >= 0);
  assert.ok(linkIndex > revokeIndex);
  const linkCall = calls[linkIndex];
  assert.ok(linkCall);
  const linkBody = JSON.parse(linkCall.options.body);
  assert.equal(linkBody._user_id, userId);
  assert.equal(linkBody._account_id, 42);
  assert.equal(linkBody._installation_id, 77);
});

test('OAuth callback rejects spoofed installation_id not authorized to GitHub user', async () => {
  const env = baseEnv();
  const auth = { verify: async () => ({ userId: '00000000-0000-4000-8000-000000000001' }) };
  let storeReached = false;
  const fetchImpl = async (url) => {
    if (String(url) === 'https://github.com/login/oauth/access_token') {
      return new Response(JSON.stringify({ access_token: 'github-user-token' }), { status: 200 });
    }
    if (String(url).startsWith('https://api.github.com/user/installations')) {
      return new Response(JSON.stringify({
        installations: [{ id: 88, account: { id: 99, login: 'other', type: 'Organization' } }],
      }), { status: 200 });
    }
    storeReached = true;
    throw new Error('must not reach Marketplace/store');
  };
  const marketplace = createCadsMarketplace({ env, auth, fetchImpl });
  const setupRes = redirectHarness();
  await marketplace.handle(
    { method: 'GET', headers: {} },
    setupRes,
    new URL('https://capital-ai.online/api/cads/marketplace/setup?installation_id=77'),
    () => { throw new Error('json response not expected'); },
  );
  const state = new URL(setupRes.headers.location).searchParams.get('state');
  const cookie = String(setupRes.headers['set-cookie']).split(';')[0];
  let status = 0;
  let payload = null;
  await marketplace.handle(
    { method: 'GET', headers: { cookie } },
    redirectHarness(),
    new URL('https://capital-ai.online/api/cads/marketplace/oauth/callback?code=oauth-code&state=' + encodeURIComponent(state)),
    (_res, nextStatus, nextPayload) => { status = nextStatus; payload = nextPayload; },
  );
  assert.equal(status, 401);
  assert.equal(payload.error, 'marketplace_oauth_authorization_failed');
  assert.equal(storeReached, false);
});

test('unauthenticated Marketplace setup redirects only to same-origin login continuation', async () => {
  const env = baseEnv();
  const marketplace = createCadsMarketplace({
    env,
    auth: { verify: async () => null },
  });
  const res = redirectHarness();
  await marketplace.handle(
    { method: 'GET', headers: {} },
    res,
    new URL('https://capital-ai.online/api/cads/marketplace/setup?installation_id=77&marketplace_listing_plan_id=1003'),
    () => { throw new Error('json response not expected'); },
  );
  assert.equal(res.status, 303);
  const location = new URL(res.headers.location, 'https://capital-ai.online');
  assert.equal(location.origin, 'https://capital-ai.online');
  assert.equal(location.pathname, '/login');
  assert.equal(
    location.searchParams.get('next'),
    '/api/cads/marketplace/setup?installation_id=77',
  );
});
