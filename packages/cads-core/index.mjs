export const CADS_TIERS = Object.freeze({
  starter: Object.freeze({
    label: 'Starter',
    capabilities: Object.freeze({
      standardProfiles: true,
      githubCheck: 'neutral',
      history: false,
      regressionDetection: false,
      evidenceExport: false,
      customProfiles: false,
      customThresholds: false,
      enforcedPrGate: false,
      api: false,
      selfHostedRunner: false,
    }),
  }),
  pro: Object.freeze({
    label: 'Pro',
    capabilities: Object.freeze({
      standardProfiles: true,
      githubCheck: 'neutral',
      history: true,
      regressionDetection: true,
      evidenceExport: true,
      customProfiles: false,
      customThresholds: false,
      enforcedPrGate: false,
      api: false,
      selfHostedRunner: false,
    }),
  }),
  enterprise: Object.freeze({
    label: 'Enterprise',
    capabilities: Object.freeze({
      standardProfiles: true,
      githubCheck: 'enforced',
      history: true,
      regressionDetection: true,
      evidenceExport: true,
      customProfiles: true,
      customThresholds: true,
      enforcedPrGate: true,
      api: true,
      selfHostedRunner: true,
    }),
  }),
});

export function cadsEntitlementForTier(tier) {
  const entitlement = CADS_TIERS[tier];
  if (!entitlement) throw new RangeError('UNSUPPORTED_CADS_TIER');
  return entitlement;
}
