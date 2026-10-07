export const BILLING_CATALOG = Object.freeze({
  version: '2026-10-04-vocabulary',
  currency: 'eur',
  tiers: {
    starter: { productId: 'prod_VMtsmoPBqTHdww', monthlyPriceId: 'price_1UMA4qPKr4joNbEcvJXFWw45', annualPriceId: 'price_1UMA4wPKr4joNbEc1tgkxagi' },
    pro: { productId: 'prod_VMtsNeuSad0Dvx', monthlyPriceId: 'price_1UMA4yPKr4joNbEckWSj3cJE', annualPriceId: 'price_1UMA50PKr4joNbEcrj0Lm79I' },
    enterprise: { productId: 'prod_VMtsvVRz0nORcx', monthlyPriceId: 'price_1UMA51PKr4joNbEcbtWNCcCc', annualPriceId: 'price_1UMA53PKr4joNbEc3E3XyzgG' },
  },
  addons: {
    vocabulary: {
      productId: 'prod_VNTsrtlf2ZL8ja',
      priceId: 'price_1UMiuIPKr4joNbEclpn8AwFW',
      amountCents: 1900,
      taxBehavior: 'inclusive',
    },
  },
});
