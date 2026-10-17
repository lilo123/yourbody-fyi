export interface PricingFeature {
  label: string;
  strongPrefix?: string;
  dynamicLabel?: (billingPeriod: 'monthly' | 'yearly') => string;
}

export interface PricingTier {
  id: string;
  name: string;
  badge: string;
  badgeClass: string;
  cardBorderClass?: string;
  price: number;
  priceCurrency: string;
  monthlyPrice?: number;
  yearlyPrice?: number;
  monthlyPriceDisplay?: string;
  yearlyPriceDisplay?: string;
  description: string;
  features: readonly PricingFeature[];
  cta: {
    label: string;
    href?: string;
    disabled?: boolean;
  };
}

export const PRICING_TIERS: readonly PricingTier[] = [
  {
    id: 'free',
    name: 'Free forever',
    badge: 'Forever',
    badgeClass: 'bg-cyan-500/10 text-cyan-300 border border-cyan-500/20',
    price: 0,
    priceCurrency: 'USD',
    description: 'Full offline workout and meal tracking for personal lifters.',
    features: [
      { label: ' 14-day trial (30/day)', strongPrefix: 'AI Meal Logging:' },
      { label: ' Up to 3 athletes', strongPrefix: 'Coach Mode:' },
      { label: 'Workout & meal tracking' },
      { label: 'Quick log & on-device parsing' },
    ],
    cta: {
      label: 'Start free',
      href: '/login?mode=signup',
      disabled: false,
    },
  },
  {
    id: 'personal',
    name: 'Personal',
    badge: 'Coming soon',
    badgeClass: 'bg-amber-500/10 text-amber-300 border border-amber-500/30',
    price: 2,
    monthlyPrice: 2,
    yearlyPrice: 10,
    monthlyPriceDisplay: '$2',
    yearlyPriceDisplay: '$10',
    priceCurrency: 'USD',
    description: 'For everyday lifters who want continuous daily AI meal logging.',
    features: [
      { label: ' 20 / day (photo = 2)', strongPrefix: 'AI Meal Logging:' },
      { label: ' Up to 3 athletes', strongPrefix: 'Coach Mode:' },
      { label: 'All Free tier features included' },
      {
        label: '$10/yr when billed yearly',
        dynamicLabel: (billingPeriod: 'monthly' | 'yearly') =>
          billingPeriod === 'yearly' ? 'Save ~58% vs monthly' : '$10/yr when billed yearly',
      },
    ],
    cta: {
      label: 'Coming soon',
      disabled: true,
    },
  },
  {
    id: 'coach',
    name: 'Coach',
    badge: 'Coming soon',
    badgeClass: 'bg-amber-500/10 text-amber-300 border border-amber-500/30',
    cardBorderClass: 'border-cyan-500/30 shadow-lg',
    price: 5,
    monthlyPrice: 5,
    yearlyPrice: 40,
    monthlyPriceDisplay: '$5',
    yearlyPriceDisplay: '$40',
    priceCurrency: 'USD',
    description: 'For trainers managing up to 10 athletes with client AI benefits.',
    features: [
      { label: ' 30 / day', strongPrefix: 'AI Meal Logging:' },
      { label: ' Up to 10 athletes', strongPrefix: 'Coach Mode:' },
      { label: ' 10 / day each', strongPrefix: 'Athlete AI:' },
      { label: 'Coach dashboard (activity, macros & routines)' },
    ],
    cta: {
      label: 'Coming soon',
      disabled: true,
    },
  },
  {
    id: 'coach_pro',
    name: 'Coach Pro',
    badge: 'Coming soon',
    badgeClass: 'bg-amber-500/10 text-amber-300 border border-amber-500/30',
    price: 10,
    monthlyPrice: 10,
    yearlyPrice: 80,
    monthlyPriceDisplay: '$10',
    yearlyPriceDisplay: '$80',
    priceCurrency: 'USD',
    description: 'For active coaching practices managing up to 25 athletes.',
    features: [
      { label: ' 30 / day', strongPrefix: 'AI Meal Logging:' },
      { label: ' Up to 25 athletes', strongPrefix: 'Coach Mode:' },
      { label: ' 10 / day each', strongPrefix: 'Athlete AI:' },
      { label: 'Coach dashboard (activity, macros & routines)' },
    ],
    cta: {
      label: 'Coming soon',
      disabled: true,
    },
  },
] as const;

export function getFreePricingTier(tiers: readonly PricingTier[] = PRICING_TIERS): PricingTier {
  const freeTier = tiers.find((tier) => tier.price === 0);
  if (!freeTier) {
    throw new Error('No free plan found in pricing tiers');
  }
  return freeTier;
}

export interface JsonLdOffer {
  '@type': 'Offer';
  price: string;
  priceCurrency: string;
  name: string;
}

export function generateFreeOffer(tiers: readonly PricingTier[] = PRICING_TIERS): JsonLdOffer {
  const freeTier = getFreePricingTier(tiers);
  return {
    '@type': 'Offer',
    price: String(freeTier.price),
    priceCurrency: freeTier.priceCurrency,
    name: freeTier.name,
  };
}

export interface SoftwareApplicationJsonLd {
  '@context': 'https://schema.org';
  '@type': 'SoftwareApplication';
  name: string;
  url: string;
  applicationCategory: string;
  operatingSystem: string;
  description: string;
  offers: JsonLdOffer;
}

export function generateSoftwareApplicationJsonLd(
  description: string = 'A no-frills workout and meal tracker. Free forever, with coach mode built in. Your data stays yours.',
  tiers: readonly PricingTier[] = PRICING_TIERS
): SoftwareApplicationJsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Yourbody.fyi',
    url: 'https://www.yourbody.fyi/',
    applicationCategory: 'HealthApplication',
    operatingSystem: 'Web',
    description,
    offers: generateFreeOffer(tiers),
  };
}
