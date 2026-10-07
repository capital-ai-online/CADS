import { createHash, createHmac, createSign, randomBytes, timingSafeEqual } from 'node:crypto';
import { cadsEntitlementForTier } from '../packages/cads-core/index.mjs';
import { boundedJson, secureUrl } from './http-security.mjs';

const GITHUB_API_VERSION = '2026-03-10';
const MARKETPLACE_WEBHOOK_PATH = '/api/integrations/github/cads-marketplace';
const MARKETPLACE_READINESS_PATH = '/api/cads/marketplace/readiness';
const MARKETPLACE_SETUP_PATH = '/api/cads/marketplace/setup';
const MARKETPLACE_OAUTH_CALLBACK_PATH = '/api/cads/marketplace/oauth/callback';
const PAID_TIERS = Object.freeze(['starter', 'pro', 'enterprise']);
const PURCHASE_ACTIONS = new Set(['purchased', 'changed', 'cancelled']);
const MAX_WEBHOOK_BYTES = 256 * 1024;
const CANCELLATION_RETENTION_DAYS = 29;

function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function boundedText(value, maxLength = 255) {
  const text = String(value ?? '').trim();
  return text && text.length <= maxLength ? text : null;
}

function serviceRoleJwt(key) {
  if (!key?.startsWith('eyJ')) return false;
  const parts = key.split('.');
  if (parts.length !== 3) return false;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))?.role === 'service_role';
  } catch {
    return false;
  }
}

function supabaseConfig(env) {
  try {
    const url = secureUrl(env.SUPABASE_URL || env.VITE_SUPABASE_URL);
    const key = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '';
    if (url.href !== url.origin + '/' || !(key.startsWith('sb_secret_') || serviceRoleJwt(key))) return null;
    return { url: url.origin, key };
  } catch {
    return null;
  }
}

export function cadsMarketplaceConfig(env = process.env) {
  const appId = positiveInteger(env.CADS_GITHUB_APP_ID);
  const ownerOrg = boundedText(env.CADS_GITHUB_MARKETPLACE_OWNER_ORG, 100);
  const listingSlug = boundedText(env.CADS_GITHUB_MARKETPLACE_LISTING_SLUG, 100);
  const privateKey = String(env.CADS_GITHUB_APP_PRIVATE_KEY || '');
  const webhookSecret = String(env.CADS_GITHUB_MARKETPLACE_WEBHOOK_SECRET || '');
  const clientId = boundedText(env.CADS_GITHUB_CLIENT_ID, 200);
  const clientSecret = String(env.CADS_GITHUB_CLIENT_SECRET || '');
  const oauthStateSecret = String(env.CADS_GITHUB_OAUTH_STATE_SECRET || '');
  let publicUrl = null;
  try {
    const parsed = secureUrl(env.CADS_GITHUB_PUBLIC_URL || '');
    if (parsed.href === parsed.origin + '/') publicUrl = parsed.origin;
  } catch {}
  const planIds = {
    starter: positiveInteger(env.CADS_GITHUB_MARKETPLACE_STARTER_PLAN_ID),
    pro: positiveInteger(env.CADS_GITHUB_MARKETPLACE_PRO_PLAN_ID),
    enterprise: positiveInteger(env.CADS_GITHUB_MARKETPLACE_ENTERPRISE_PLAN_ID),
  };
  const ids = Object.values(planIds);
  const distinctPlanIds = ids.every(Boolean) && new Set(ids).size === ids.length;
  const appConfigured =
    Boolean(appId && ownerOrg && listingSlug) &&
    privateKey.startsWith('-----BEGIN') &&
    webhookSecret.length >= 32;
  const oauthConfigured =
    Boolean(clientId && publicUrl) &&
    clientSecret.length >= 32 &&
    oauthStateSecret.length >= 32;
  const store = supabaseConfig(env);

  return Object.freeze({
    appId,
    ownerOrg,
    listingSlug,
    privateKey,
    webhookSecret,
    clientId,
    clientSecret,
    oauthStateSecret,
    publicUrl,
    planIds: Object.freeze(planIds),
    distinctPlanIds,
    store,
    appConfigured,
    oauthConfigured,
    runtimeReady: Boolean(appConfigured && oauthConfigured && distinctPlanIds && store),
  });
}

export function publicCadsMarketplaceReadiness(env = process.env) {
  const config = cadsMarketplaceConfig(env);
  return Object.freeze({
    schema: 'CAPITAL_AI_CADS_MARKETPLACE_READINESS@1',
    target: 'PAID_PRODUCTION',
    plans: PAID_TIERS,
    pricingAuthority: 'GITHUB_MARKETPLACE_LISTING',
    pricingCurrency: 'USD',
    monthlyAndAnnualRequired: true,
    freePlanEnabled: false,
    appConfigured: config.appConfigured,
    buyerLinkConfigured: config.oauthConfigured,
    planIdsConfigured: config.distinctPlanIds,
    entitlementStoreConfigured: Boolean(config.store),
    runtimeReady: config.runtimeReady,
    externalAdmission: {
      organizationOwnedAppRequired: true,
      verifiedPublisherRequired: true,
      minimumInstallations: 100,
      financialOnboardingRequired: true,
      listingApprovalRequired: true,
    },
  });
}

export function tierForMarketplacePlanId(planId, env = process.env) {
  const config = cadsMarketplaceConfig(env);
  const normalized = positiveInteger(planId);
  if (!normalized) return null;
  for (const tier of PAID_TIERS) {
    if (config.planIds[tier] === normalized) return tier;
  }
  return null;
}

export function highestCadsTier(...tiers) {
  const rank = { starter: 1, pro: 2, enterprise: 3 };
  return tiers
    .filter(tier => PAID_TIERS.includes(tier))
    .sort((left, right) => rank[right] - rank[left])[0] || null;
}

function verifySignature(rawBody, header, secret) {
  if (!Buffer.isBuffer(rawBody) || !header?.startsWith('sha256=') || !secret) return false;
  const expected = Buffer.from('sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex'));
  const actual = Buffer.from(String(header));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function readRawJson(req, maxBytes = MAX_WEBHOOK_BYTES) {
  if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
    return Promise.reject(new Error('invalid_content_type'));
  }
  return new Promise((resolve, reject) => {
    let bytes = 0;
    const chunks = [];
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      req.removeListener('data', onData);
      req.removeListener('end', onEnd);
      req.removeListener('error', onError);
      req.removeListener('aborted', onAborted);
      if (error) {
        req.resume();
        reject(error);
      } else {
        resolve(value);
      }
    };
    const onData = (chunk) => {
      bytes += chunk.length;
      if (bytes > maxBytes) return finish(new Error('body_too_large'));
      chunks.push(chunk);
    };
    const onEnd = () => {
      try {
        const rawBody = Buffer.concat(chunks);
        finish(null, { rawBody, payload: JSON.parse(rawBody.toString('utf8')) });
      } catch {
        finish(new Error('invalid_json'));
      }
    };
    const onError = () => finish(new Error('invalid_json'));
    const onAborted = () => finish(new Error('invalid_json'));
    const timer = setTimeout(() => finish(new Error('body_timeout')), 5000).unref();
    req.on('data', onData);
    req.once('end', onEnd);
    req.once('error', onError);
    req.once('aborted', onAborted);
  });
}

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function cookieValue(req, name) {
  const prefix = name + '=';
  const entry = String(req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(prefix));
  return entry ? decodeURIComponent(entry.slice(prefix.length)) : null;
}

function secureEqualText(left, right) {
  if (!left || !right) return false;
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createCadsMarketplaceOAuthState({ userId, installationId, secret, now = Date.now() }) {
  const boundedUserId = boundedText(userId, 128);
  const normalizedInstallationId = positiveInteger(installationId);
  if (!boundedUserId || !normalizedInstallationId || String(secret || '').length < 32) {
    throw new Error('invalid_marketplace_oauth_state_input');
  }
  const payload = base64url(JSON.stringify({
    v: 1,
    userId: boundedUserId,
    installationId: normalizedInstallationId,
    nonce: randomBytes(18).toString('base64url'),
    exp: Math.floor(now / 1000) + 10 * 60,
  }));
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return payload + '.' + signature;
}

export function verifyCadsMarketplaceOAuthState(state, secret, now = Date.now()) {
  if (!state || String(secret || '').length < 32) return null;
  const [payload, signature, extra] = String(state).split('.');
  if (!payload || !signature || extra) return null;
  const expected = createHmac('sha256', secret).update(payload).digest('base64url');
  if (!secureEqualText(expected, signature)) return null;
  let decoded;
  try { decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); }
  catch { return null; }
  if (decoded?.v !== 1) return null;
  if (!boundedText(decoded.userId, 128) || !positiveInteger(decoded.installationId)) return null;
  if (!Number.isInteger(decoded.exp) || decoded.exp < Math.floor(now / 1000)) return null;
  return decoded;
}

function oauthAuthorizeUrl(config, state) {
  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.publicUrl + MARKETPLACE_OAUTH_CALLBACK_PATH);
  url.searchParams.set('state', state);
  return url.toString();
}

async function exchangeOAuthCode(config, code, fetchImpl) {
  const response = await fetchImpl('https://github.com/login/oauth/access_token', {
    method: 'POST',
    redirect: 'error',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'user-agent': 'capital-ai-cads-marketplace/1',
    },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: config.publicUrl + MARKETPLACE_OAUTH_CALLBACK_PATH,
    }),
    signal: AbortSignal.timeout(7000),
  });
  const body = await boundedJson(response, 32 * 1024);
  if (!body?.access_token) throw new Error('github_oauth_exchange_failed');
  return String(body.access_token);
}

async function verifyBuyerInstallation(userToken, installationId, fetchImpl) {
  const response = await fetchImpl('https://api.github.com/user/installations?per_page=100', {
    method: 'GET',
    redirect: 'error',
    headers: {
      accept: 'application/vnd.github+json',
      authorization: 'Bearer ' + userToken,
      'x-github-api-version': GITHUB_API_VERSION,
      'user-agent': 'capital-ai-cads-marketplace/1',
    },
    signal: AbortSignal.timeout(7000),
  });
  const body = await boundedJson(response, 128 * 1024);
  const installation = (body?.installations || []).find(item => positiveInteger(item?.id) === positiveInteger(installationId));
  if (!installation?.account?.id || !installation?.account?.login || !['User','Organization'].includes(installation?.account?.type)) {
    throw new Error('github_installation_not_authorized');
  }
  return installation;
}

async function revokeOAuthToken(config, userToken, fetchImpl) {
  const basic = Buffer.from(config.clientId + ':' + config.clientSecret).toString('base64');
  const response = await fetchImpl(
    'https://api.github.com/applications/' + encodeURIComponent(config.clientId) + '/token',
    {
      method: 'DELETE',
      redirect: 'error',
      headers: {
        accept: 'application/vnd.github+json',
        authorization: 'Basic ' + basic,
        'content-type': 'application/json',
        'x-github-api-version': GITHUB_API_VERSION,
        'user-agent': 'capital-ai-cads-marketplace/1',
      },
      body: JSON.stringify({ access_token: userToken }),
      signal: AbortSignal.timeout(7000),
    },
  );
  if (response.status !== 204) {
    await response.body?.cancel();
    throw new Error('github_oauth_token_revocation_failed');
  }
  await response.body?.cancel();
}

export function createCadsGitHubAppJwt({ appId, privateKey, now = Math.floor(Date.now() / 1000) }) {
  if (!positiveInteger(appId) || !privateKey?.startsWith('-----BEGIN')) throw new Error('invalid_github_app_credentials');
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ iat: now - 60, exp: now + 9 * 60, iss: String(appId) }));
  const unsigned = header + '.' + payload;
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  return unsigned + '.' + signer.sign(privateKey, 'base64url');
}

async function githubMarketplaceSubscription(accountId, config, fetchImpl) {
  const jwt = createCadsGitHubAppJwt(config);
  const response = await fetchImpl(
    'https://api.github.com/marketplace_listing/accounts/' + encodeURIComponent(String(accountId)),
    {
      method: 'GET',
      redirect: 'error',
      headers: {
        accept: 'application/vnd.github+json',
        authorization: 'Bearer ' + jwt,
        'x-github-api-version': GITHUB_API_VERSION,
        'user-agent': 'capital-ai-cads-marketplace/1',
      },
      signal: AbortSignal.timeout(7000),
    },
  );
  if (response.status === 404) {
    await response.body?.cancel();
    return null;
  }
  return boundedJson(response, 64 * 1024);
}

function storeHeaders(key) {
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    apikey: key,
  };
  if (key.startsWith('eyJ')) headers.Authorization = 'Bearer ' + key;
  return headers;
}

async function storeRpc(fetchImpl, store, name, body) {
  const response = await fetchImpl(new URL('/rest/v1/rpc/' + name, store.url), {
    method: 'POST',
    headers: storeHeaders(store.key),
    body: JSON.stringify(body),
    redirect: 'error',
    signal: AbortSignal.timeout(7000),
  });
  let payload = null;
  if (response.status !== 204) {
    try { payload = await boundedJson(response, 64 * 1024); } catch { payload = null; }
  }
  if (!response.ok) {
    const error = new Error('CADS_MARKETPLACE_STORE_FAILED');
    error.status = response.status;
    throw error;
  }
  return payload;
}

export function createCadsMarketplace({
  env = process.env,
  fetchImpl = fetch,
  audit = () => {},
  auth,
  now = () => new Date(),
} = {}) {
  const config = cadsMarketplaceConfig(env);
  let cleanupTimer = null;

  async function purgeCancelledData() {
    if (!config.store) return { configured: false };
    const before = new Date(now().getTime() - CANCELLATION_RETENTION_DAYS * 86400000).toISOString();
    const result = await storeRpc(fetchImpl, config.store, 'capital_ai_purge_cads_marketplace_data', { _before: before });
    return { configured: true, before, result };
  }

  async function applyPurchase({ deliveryId, action, account, planId, tier, effectiveAt, payloadHash }) {
    return storeRpc(fetchImpl, config.store, 'capital_ai_apply_cads_marketplace_purchase', {
      _delivery_id: deliveryId,
      _action: action,
      _account_id: account.id,
      _account_login: account.login,
      _account_type: account.type,
      _marketplace_plan_id: planId,
      _tier: tier,
      _effective_at: effectiveAt,
      _payload_sha256: payloadHash,
    });
  }

  async function authoritativeTierForAccount(accountId) {
    const subscription = await githubMarketplaceSubscription(accountId, config, fetchImpl);
    if (!subscription) return { subscription: null, tier: null, accountId: null, planId: null };
    const readbackAccountId = positiveInteger(subscription.id ?? subscription.account?.id);
    const readbackPlanId = positiveInteger(
      subscription.marketplace_purchase?.plan?.id ??
      subscription.plan?.id
    );
    const tier = tierForMarketplacePlanId(readbackPlanId, env);
    return { subscription, tier, accountId: readbackAccountId, planId: readbackPlanId };
  }

  async function linkUser({ userId, accountId, installationId }) {
    if (!config.store) throw new Error('marketplace_store_not_configured');
    return storeRpc(fetchImpl, config.store, 'capital_ai_link_cads_marketplace_user', {
      _user_id: userId,
      _account_id: accountId,
      _installation_id: installationId,
    });
  }

  async function resolveTierForUser(userId) {
    if (!config.store || !boundedText(userId, 128)) return null;
    const payload = await storeRpc(fetchImpl, config.store, 'capital_ai_get_cads_marketplace_user_entitlement', {
      _user_id: userId,
    });
    const tier = boundedText(payload?.tier, 32);
    return PAID_TIERS.includes(tier) ? tier : null;
  }

  async function handleSetup(req, res, url, json) {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      json(res, 405, { error: 'method_not_allowed' });
      return true;
    }
    if (!config.runtimeReady) {
      json(res, 503, { error: 'cads_marketplace_not_configured' });
      return true;
    }
    const installationId = positiveInteger(url.searchParams.get('installation_id'));
    if (!installationId) {
      json(res, 400, { error: 'invalid_installation_id' });
      return true;
    }
    const user = await auth?.verify?.(req, res);
    if (!user?.userId) {
      const next = MARKETPLACE_SETUP_PATH + '?installation_id=' + encodeURIComponent(String(installationId));
      res.writeHead(303, {
        Location: '/login?next=' + encodeURIComponent(next),
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
      });
      res.end();
      return true;
    }
    const state = createCadsMarketplaceOAuthState({
      userId: user.userId,
      installationId,
      secret: config.oauthStateSecret,
      now: now().getTime(),
    });
    const cookie = 'cads_marketplace_oauth_state=' + encodeURIComponent(state) +
      '; HttpOnly; Secure; SameSite=Lax; Path=' + MARKETPLACE_OAUTH_CALLBACK_PATH + '; Max-Age=600';
    res.writeHead(302, {
      Location: oauthAuthorizeUrl(config, state),
      'Set-Cookie': cookie,
      'Cache-Control': 'no-store',
    });
    res.end();
    return true;
  }

  async function handleOAuthCallback(req, res, url, json) {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      json(res, 405, { error: 'method_not_allowed' });
      return true;
    }
    if (!config.runtimeReady) {
      json(res, 503, { error: 'cads_marketplace_not_configured' });
      return true;
    }
    const state = url.searchParams.get('state');
    const cookieState = cookieValue(req, 'cads_marketplace_oauth_state');
    if (!secureEqualText(state, cookieState)) {
      json(res, 401, { error: 'marketplace_oauth_state_mismatch' });
      return true;
    }
    const statePayload = verifyCadsMarketplaceOAuthState(state, config.oauthStateSecret, now().getTime());
    const user = await auth?.verify?.(req, res);
    if (!statePayload || !user?.userId || user.userId !== statePayload.userId) {
      json(res, 401, { error: 'marketplace_oauth_identity_mismatch' });
      return true;
    }
    const code = boundedText(url.searchParams.get('code'), 512);
    if (!code) {
      json(res, 400, { error: 'missing_oauth_code' });
      return true;
    }

    try {
      const userToken = await exchangeOAuthCode(config, code, fetchImpl);
      const installation = await verifyBuyerInstallation(userToken, statePayload.installationId, fetchImpl);
      const accountId = positiveInteger(installation.account.id);
      const readback = await authoritativeTierForAccount(accountId);
      if (!readback.subscription || !readback.tier) {
        await revokeOAuthToken(config, userToken, fetchImpl);
        json(res, 403, { error: 'active_marketplace_subscription_required' });
        return true;
      }
      await revokeOAuthToken(config, userToken, fetchImpl);
      await linkUser({
        userId: user.userId,
        accountId,
        installationId: statePayload.installationId,
      });
      audit({ eventType: 'cads.marketplace.user_link', result: 'LINKED', tier: readback.tier });
      res.writeHead(303, {
        Location: '/profile?cads_marketplace=linked',
        'Set-Cookie': 'cads_marketplace_oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=' +
          MARKETPLACE_OAUTH_CALLBACK_PATH + '; Max-Age=0',
        'Cache-Control': 'no-store',
      });
      res.end();
      return true;
    } catch {
      json(res, 401, { error: 'marketplace_oauth_authorization_failed' });
      return true;
    }
  }

  async function handle(req, res, url, json) {
    if (url.pathname === MARKETPLACE_SETUP_PATH) return handleSetup(req, res, url, json);
    if (url.pathname === MARKETPLACE_OAUTH_CALLBACK_PATH) return handleOAuthCallback(req, res, url, json);

    if (url.pathname === MARKETPLACE_READINESS_PATH) {
      if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        json(res, 405, { error: 'method_not_allowed' });
        return true;
      }
      json(res, 200, publicCadsMarketplaceReadiness(env));
      return true;
    }

    if (url.pathname !== MARKETPLACE_WEBHOOK_PATH) return false;
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      json(res, 405, { error: 'method_not_allowed' });
      return true;
    }
    if (!config.runtimeReady) {
      json(res, 503, { error: 'cads_marketplace_not_configured' });
      return true;
    }

    let body;
    try {
      body = await readRawJson(req);
    } catch (error) {
      json(res, error.message === 'body_too_large' ? 413 : 400, { error: 'invalid_webhook_request' });
      return true;
    }

    if (!verifySignature(body.rawBody, req.headers['x-hub-signature-256'], config.webhookSecret)) {
      audit({ eventType: 'cads.marketplace.webhook.denied', result: 'INVALID_SIGNATURE' });
      json(res, 401, { error: 'invalid_webhook_signature' });
      return true;
    }

    const eventName = String(req.headers['x-github-event'] || '');
    if (eventName !== 'marketplace_purchase') {
      json(res, 202, { accepted: true, ignored: true });
      return true;
    }

    const deliveryId = boundedText(req.headers['x-github-delivery'], 128);
    const action = String(body.payload?.action || '');
    const purchase = body.payload?.marketplace_purchase;
    const account = {
      id: positiveInteger(purchase?.account?.id),
      login: boundedText(purchase?.account?.login, 255),
      type: boundedText(purchase?.account?.type, 32),
    };
    if (
      !deliveryId ||
      !/^[A-Za-z0-9-]{8,128}$/.test(deliveryId) ||
      !PURCHASE_ACTIONS.has(action) ||
      !account.id ||
      !account.login ||
      !['User', 'Organization'].includes(account.type)
    ) {
      json(res, 400, { error: 'invalid_marketplace_purchase' });
      return true;
    }

    let planId = positiveInteger(purchase?.plan?.id);
    let tier = tierForMarketplacePlanId(planId, env);

    if (action === 'purchased' || action === 'changed') {
      let readback;
      try {
        readback = await authoritativeTierForAccount(account.id);
      } catch {
        json(res, 503, { error: 'marketplace_readback_unavailable' });
        return true;
      }
      const readbackAccountId = readback.accountId;
      const readbackPlanId = readback.planId;
      if (!readback.subscription || readbackAccountId !== account.id || !readback.tier || readbackPlanId !== planId) {
        audit({ eventType: 'cads.marketplace.webhook.denied', action, result: 'READBACK_MISMATCH' });
        json(res, 409, { error: 'marketplace_readback_mismatch' });
        return true;
      }
      tier = readback.tier;
      planId = readbackPlanId;
    }

    if (!tier || !planId) {
      audit({ eventType: 'cads.marketplace.webhook.denied', action, result: 'UNRECOGNIZED_PLAN' });
      json(res, 409, { error: 'unrecognized_marketplace_plan' });
      return true;
    }

    const entitlement = cadsEntitlementForTier(tier);
    const effectiveAt = boundedText(body.payload?.effective_date, 64) || now().toISOString();
    const payloadHash = createHash('sha256').update(body.rawBody).digest('hex');

    let result;
    try {
      result = await applyPurchase({
        deliveryId,
        action,
        account,
        planId,
        tier,
        effectiveAt,
        payloadHash,
      });
    } catch {
      json(res, 503, { error: 'marketplace_entitlement_store_unavailable' });
      return true;
    }

    audit({
      eventType: 'cads.marketplace.purchase',
      action,
      result: result?.duplicate ? 'DUPLICATE' : 'APPLIED',
      tier,
    });
    json(res, 200, {
      accepted: true,
      duplicate: Boolean(result?.duplicate),
      action,
      tier,
      capabilities: entitlement.capabilities,
      billingAuthority: 'GITHUB_MARKETPLACE',
      entitlementOnly: true,
      productionEligible: false,
      decisionEligible: false,
    });
    return true;
  }

  function start() {
    if (!config.store || cleanupTimer) return;
    void purgeCancelledData().catch(() => {});
    cleanupTimer = setInterval(() => {
      void purgeCancelledData().catch(() => {});
    }, 12 * 60 * 60 * 1000);
    cleanupTimer.unref();
  }

  function close() {
    if (cleanupTimer) clearInterval(cleanupTimer);
    cleanupTimer = null;
  }

  return Object.freeze({
    handle,
    start,
    close,
    readiness: () => publicCadsMarketplaceReadiness(env),
    purgeCancelledData,
    authoritativeTierForAccount,
    resolveTierForUser,
    linkUser,
  });
}
