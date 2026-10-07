import { CADS_TIERS, cadsEntitlementForTier } from '../packages/cads-core/index.mjs';
import { BILLING_CATALOG } from './billing-catalog.mjs';
import { highestCadsTier, publicCadsMarketplaceReadiness } from './cads-marketplace.mjs';

function publicTierProjection() {
  return Object.fromEntries(Object.entries(CADS_TIERS).map(([tier, entitlement]) => [
    tier,
    {
      label: entitlement.label,
      capabilities: { ...entitlement.capabilities },
      stripeProductId: BILLING_CATALOG.tiers[tier]?.productId || null,
    },
  ]));
}

export function createCadsCommerce({ auth, env = process.env, marketplace } = {}) {
  async function handle(req, res, url, json) {
    if (url.pathname === '/api/cads/commerce/readiness') {
      if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        json(res, 405, { error: 'method_not_allowed' });
        return true;
      }
      json(res, 200, {
        schema: 'CAPITAL_AI_CADS_COMMERCE_READINESS@1',
        product: 'CADS Decision Score',
        websiteBillingAuthority: 'server/billing-catalog.mjs',
        websiteEntitlementAuthority: 'public.subscriptions via auth.resolvePaidTier',
        capabilityAuthority: 'packages/cads-core/index.mjs',
        catalogVersion: BILLING_CATALOG.version,
        tiers: publicTierProjection(),
        checkoutPath: '/api/billing/subscriptions/checkout',
        githubMarketplace: {
          ...publicCadsMarketplaceReadiness(env),
          billingAuthority: 'GITHUB_MARKETPLACE',
          entitlementAuthority: 'GITHUB_MARKETPLACE_API_PLUS_SUPABASE_LEDGER',
          stripeStatusAuthoritative: false,
          marketplacePurchaseLifecycleImplemented: true,
        },
        productionEligible: false,
        decisionEligible: false,
      });
      return true;
    }

    if (url.pathname !== '/api/cads/commerce/entitlement') return false;
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      json(res, 405, { error: 'method_not_allowed' });
      return true;
    }

    const user = await auth?.verify?.(req, res);
    if (!user?.userId) {
      json(res, 401, { error: 'authentication_required' });
      return true;
    }

    const websiteTier = await auth?.resolvePaidTier?.(req, res);
    let marketplaceTier = null;
    try {
      marketplaceTier = await marketplace?.resolveTierForUser?.(user.userId);
    } catch {
      marketplaceTier = null;
    }
    const tier = highestCadsTier(websiteTier, marketplaceTier);
    if (!tier) {
      json(res, 403, {
        error: 'paid_cads_entitlement_required',
        checkoutPath: '/api/billing/subscriptions/checkout',
        marketplaceSetupRequired: true,
      });
      return true;
    }

    let entitlement;
    try {
      entitlement = cadsEntitlementForTier(tier);
    } catch {
      json(res, 403, { error: 'paid_cads_entitlement_required' });
      return true;
    }

    const authorities = [
      ...(websiteTier ? ['STRIPE_SUBSCRIPTION'] : []),
      ...(marketplaceTier ? ['GITHUB_MARKETPLACE'] : []),
    ];

    json(res, 200, {
      schema: 'CAPITAL_AI_CADS_ENTITLEMENT@2',
      product: 'CADS Decision Score',
      tier,
      label: entitlement.label,
      capabilities: { ...entitlement.capabilities },
      billingAuthority: authorities.length === 2 ? 'MULTI_CHANNEL' : authorities[0],
      entitlementAuthorities: authorities,
      websiteEntitlement: Boolean(websiteTier),
      marketplaceEntitlement: Boolean(marketplaceTier),
      entitlementOnly: true,
      productionEligible: false,
      decisionEligible: false,
    });
    return true;
  }

  return { handle };
}
