import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { LandingView } from './LandingView';

describe('LandingView component', () => {
  const renderLanding = () =>
    render(
      <BrowserRouter>
        <LandingView />
      </BrowserRouter>
    );

  it('renders main headline and subhead', () => {
    renderLanding();
    const heading = screen.getByRole('heading', {
      level: 1,
      name: /Track workouts and meals\. Even without signal\./i,
    });
    expect(heading).toBeDefined();

    expect(
      screen.getByText(/A fast workout and nutrition tracker that keeps working when your gym has no signal/i)
    ).toBeDefined();
  });

  it('renders pricing tiers with prices and visible "Coming soon" label on paid tiers', () => {
    renderLanding();

    // Free tier
    expect(screen.getByText('Free')).toBeDefined();
    expect(screen.getByText('$0')).toBeDefined();

    // Paid tiers
    expect(screen.getByText('Personal')).toBeDefined();
    expect(screen.getByText('Coach')).toBeDefined();
    expect(screen.getByText('Coach Pro')).toBeDefined();

    // "Coming soon" labels on paid tiers
    const comingSoonBadges = screen.getAllByText(/Coming soon/i);
    // At least 3 badges (Personal, Coach, Coach Pro) plus their disabled buttons
    expect(comingSoonBadges.length).toBeGreaterThanOrEqual(3);
  });

  it('toggles between monthly and yearly pricing discounts', () => {
    renderLanding();

    // Default monthly
    expect(screen.getByText('$2')).toBeDefined();
    expect(screen.getByText('$5')).toBeDefined();
    expect(screen.getByText('$10')).toBeDefined();

    // Toggle yearly
    const yearlyBtn = screen.getByRole('button', { name: /Yearly/i });
    fireEvent.click(yearlyBtn);

    expect(screen.getByText('$40')).toBeDefined();
    expect(screen.getByText('$80')).toBeDefined();
  });

  it('renders CTAs and navigation links pointing to expected routes', () => {
    renderLanding();

    // CTA "Start free" links
    const startFreeLinks = screen.getAllByRole('link', { name: /Start free/i });
    expect(startFreeLinks.length).toBeGreaterThanOrEqual(1);
    expect(startFreeLinks[0].getAttribute('href')).toBe('/login?mode=signup');

    // "Sign in" links
    const signInLinks = screen.getAllByRole('link', { name: /Sign in/i });
    expect(signInLinks.length).toBeGreaterThanOrEqual(1);
    expect(signInLinks[0].getAttribute('href')).toBe('/login');

    // Footer links
    const termsLink = screen.getByRole('link', { name: /Terms of Service/i });
    expect(termsLink.getAttribute('href')).toBe('/terms');

    const privacyLink = screen.getByRole('link', { name: /Privacy Policy/i });
    expect(privacyLink.getAttribute('href')).toBe('/privacy');

    const refundsLink = screen.getByRole('link', { name: /Refund Policy/i });
    expect(refundsLink.getAttribute('href')).toBe('/refunds');
  });

  it('renders FAQ section and expands items on click', () => {
    renderLanding();

    const offlineFaq = screen.getByRole('button', { name: /Does it work offline\?/i });
    expect(offlineFaq).toBeDefined();

    // Click to expand
    fireEvent.click(offlineFaq);
    expect(
      screen.getByText(/Yes for workout logging, set tracking, quick log, and on-device parsing\./i)
    ).toBeDefined();
  });
});
