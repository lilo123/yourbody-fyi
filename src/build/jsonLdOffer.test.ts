import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  PRICING_TIERS,
  getFreePricingTier,
  generateFreeOffer,
  generateSoftwareApplicationJsonLd,
  type PricingTier,
  type JsonLdOffer,
  type SoftwareApplicationJsonLd,
} from '../components/landing/pricingData';

describe('SoftwareApplication JSON-LD Free Offer Generator & Divergence Guard', () => {
  const rootDir = path.resolve(__dirname, '../..');
  const indexHtmlPath = path.join(rootDir, 'index.html');
  const distIndexHtmlPath = path.join(rootDir, 'dist', 'index.html');
  const expectedPricingSourcePath = 'src/components/landing/pricingData.ts';

  describe('(a) Generator contract against pricing module', () => {
    it('identifies the free pricing tier from PRICING_TIERS', () => {
      const freeTier = getFreePricingTier();
      expect(freeTier).toBeDefined();
      expect(freeTier.price).toBe(0);
      expect(freeTier.name).toBe('Free forever');
      expect(freeTier.priceCurrency).toBe('USD');
    });

    it('generates @type Offer matching free plan name and price from pricing source', () => {
      const freeTier = getFreePricingTier();
      const offer: JsonLdOffer = generateFreeOffer();

      expect(offer['@type']).toBe('Offer');
      expect(offer.price).toBe(String(freeTier.price));
      expect(offer.price).toBe('0');
      expect(offer.priceCurrency).toBe(freeTier.priceCurrency);
      expect(offer.priceCurrency).toBe('USD');
      expect(offer.name).toBe(freeTier.name);
      expect(offer.name).toBe('Free forever');
    });

    it('generates valid SoftwareApplication JSON-LD with embedded free offer', () => {
      const freeTier = getFreePricingTier();
      const jsonLd: SoftwareApplicationJsonLd = generateSoftwareApplicationJsonLd();

      expect(jsonLd['@context']).toBe('https://schema.org');
      expect(jsonLd['@type']).toBe('SoftwareApplication');
      expect(jsonLd.name).toBe('Yourbody.fyi');
      expect(jsonLd.url).toBe('https://www.yourbody.fyi/');
      expect(jsonLd.applicationCategory).toBe('HealthApplication');
      expect(jsonLd.operatingSystem).toBe('Web');
      expect(jsonLd.description).toContain('Free forever');

      expect(jsonLd.offers).toEqual({
        '@type': 'Offer',
        price: String(freeTier.price),
        priceCurrency: freeTier.priceCurrency,
        name: freeTier.name,
      });
    });
  });

  describe('(b) Divergence guards and validation failures', () => {
    it('throws when no free tier exists in the pricing array', () => {
      const paidOnlyTiers: PricingTier[] = [
        {
          id: 'starter',
          name: 'Starter',
          badge: 'Paid',
          badgeClass: '',
          price: 5,
          priceCurrency: 'USD',
          description: '',
          features: [],
          cta: { label: 'Buy' },
        },
      ];

      expect(() => getFreePricingTier(paidOnlyTiers)).toThrow(
        /No free plan found in pricing tiers/i
      );
      expect(() => generateFreeOffer(paidOnlyTiers)).toThrow(
        /No free plan found in pricing tiers/i
      );
    });

    it('reflects updated free plan name or price dynamically without second hardcoded copy', () => {
      const modifiedTiers: PricingTier[] = [
        {
          ...PRICING_TIERS[0],
          name: 'Community Edition',
          price: 0,
          priceCurrency: 'USD',
        },
      ];

      const modifiedOffer = generateFreeOffer(modifiedTiers);
      expect(modifiedOffer.name).toBe('Community Edition');
      expect(modifiedOffer.price).toBe('0');

      // Crucial divergence check: if compared to the old name, it detects the mismatch
      expect(modifiedOffer.name).not.toBe(PRICING_TIERS[0].name);
    });

    it('fails validation when JSON-LD offer price or plan name diverges from pricing module', () => {
      const liveFreeTier = getFreePricingTier();

      // Helper simulating divergence detection
      const assertOfferMatchesPricing = (offer: { price: string; name: string; priceCurrency: string }) => {
        expect(offer.price).toBe(String(liveFreeTier.price));
        expect(offer.name).toBe(liveFreeTier.name);
        expect(offer.priceCurrency).toBe(liveFreeTier.priceCurrency);
      };

      // Valid case matches
      expect(() => assertOfferMatchesPricing(generateFreeOffer())).not.toThrow();

      // Divergent price fails
      const stalePriceOffer = { ...generateFreeOffer(), price: '10' };
      expect(() => assertOfferMatchesPricing(stalePriceOffer)).toThrow();

      // Divergent name fails
      const staleNameOffer = { ...generateFreeOffer(), name: 'Free Starter Plan' };
      expect(() => assertOfferMatchesPricing(staleNameOffer)).toThrow();

      // Divergent currency fails
      const staleCurrencyOffer = { ...generateFreeOffer(), priceCurrency: 'EUR' };
      expect(() => assertOfferMatchesPricing(staleCurrencyOffer)).toThrow();
    });
  });

  describe('(c) Source index.html pricing comment', () => {
    it('contains documentation comment pointing to pricingData.ts before SoftwareApplication script tag', () => {
      const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');
      const expectedComment = `<!-- SoftwareApplication JSON-LD: must match live pricing and is generated from ${expectedPricingSourcePath} -->`;
      expect(indexHtml).toContain(expectedComment);

      const commentAndScriptPattern = new RegExp(
        `<!--\\s*SoftwareApplication JSON-LD: must match live pricing and is generated from ${expectedPricingSourcePath.replace(/\\./g, '\\.')}\\s*-->\\s*<script\\s+type=["']application/ld\\+json["']>[\\s\\S]*?"@type":\\s*"SoftwareApplication"`
      );
      expect(indexHtml).toMatch(commentAndScriptPattern);
    });
  });

  describe('(d) Emitted dist/index.html build artifact validation', () => {
    it('contains emitted SoftwareApplication JSON-LD with offer matching pricing module (when dist exists)', () => {
      if (!fs.existsSync(distIndexHtmlPath)) {
        return;
      }

      const distHtml = fs.readFileSync(distIndexHtmlPath, 'utf8');
      const expectedComment = `<!-- SoftwareApplication JSON-LD: must match live pricing and is generated from ${expectedPricingSourcePath} -->`;
      expect(distHtml).toContain(expectedComment);

      const scriptRegex = /<script\s+type=["']application\/ld\+json["']>([\s\S]*?)<\/script>/gi;
      const jsonLdBlocks: string[] = [];
      let match = scriptRegex.exec(distHtml);
      while (match !== null) {
        jsonLdBlocks.push(match[1].trim());
        match = scriptRegex.exec(distHtml);
      }

      const softwareAppRaw = jsonLdBlocks.find((block) => block.includes('"SoftwareApplication"'));
      expect(softwareAppRaw).toBeDefined();

      let parsedJson: any;
      expect(() => {
        parsedJson = JSON.parse(softwareAppRaw!);
      }).not.toThrow();

      const liveFreeTier = getFreePricingTier();
      expect(parsedJson['@context']).toBe('https://schema.org');
      expect(parsedJson['@type']).toBe('SoftwareApplication');
      expect(parsedJson.offers).toBeDefined();
      expect(parsedJson.offers['@type']).toBe('Offer');
      expect(parsedJson.offers.price).toBe(String(liveFreeTier.price));
      expect(parsedJson.offers.priceCurrency).toBe(liveFreeTier.priceCurrency);
      expect(parsedJson.offers.name).toBe(liveFreeTier.name);
    });
  });
});
