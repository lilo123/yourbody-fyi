import React from 'react';
import { LandingHeader } from './LandingHeader';
import { HeroSection } from './HeroSection';
import { MealDemoSection } from './MealDemoSection';
import { FeaturesSection } from './FeaturesSection';
import { PricingSection } from './PricingSection';
import { FaqSection } from './FaqSection';
import { LandingFooter } from './LandingFooter';

export const LandingView: React.FC = () => {
  return (
    <div className="w-full min-h-screen bg-zinc-950 text-zinc-100 selection:bg-cyan-500/20 selection:text-cyan-300">
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
