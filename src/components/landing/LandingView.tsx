import React, { useEffect, useLayoutEffect } from 'react';
import { InAppBrowserBanner } from '../common/InAppBrowserBanner';
import { LandingHeader } from './LandingHeader';
import { HeroSection } from './HeroSection';
import { MealDemoSection } from './MealDemoSection';
import { FeaturesSection } from './FeaturesSection';
import { PricingSection } from './PricingSection';
import { FaqSection, FAQ_ITEMS } from './FaqSection';
import { LandingFooter } from './LandingFooter';

export const LandingView: React.FC = () => {
  useLayoutEffect(() => {
    document.getElementById('prerender')?.remove();
  }, []);

  useEffect(() => {
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.setAttribute('data-testid', 'faq-json-ld');
    script.textContent = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: FAQ_ITEMS.map((item) => ({
        '@type': 'Question',
        name: item.question,
        acceptedAnswer: {
          '@type': 'Answer',
          text: item.answer,
        },
      })),
    });
    document.head.appendChild(script);

    return () => {
      script.remove();
    };
  }, []);

  return (
    <div className="w-full min-h-screen bg-zinc-950 text-zinc-100 selection:bg-cyan-500/20 selection:text-cyan-300">
      <InAppBrowserBanner />
      <LandingHeader />
      <main className="w-full">
        <HeroSection />
        <MealDemoSection />
        <FeaturesSection />
        <PricingSection />
        <FaqSection />
      </main>
      <LandingFooter />
    </div>
  );
};

export default LandingView;
