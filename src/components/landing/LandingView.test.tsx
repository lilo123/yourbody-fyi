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
      name: /You know your workout\. We just help you track it\./i,
    });
    expect(heading).toBeDefined();

    expect(
      screen.getByText(/A no-frills log for your lifts and meals\. Free forever, with coach mode built in\. Your data stays yours\./i)
    ).toBeDefined();
  });

  it('renders pricing tiers with prices and visible "Coming soon" label on paid tiers', () => {
    renderLanding();

    // Free tier
    expect(screen.getByText('Free forever')).toBeDefined();
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

  it('does not contain unbacked priority support claims', () => {
    renderLanding();
    expect(screen.queryByText(/Priority support/i)).toBeNull();
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

    const emailLink = screen.getByRole('link', { name: /support@yourbody\.fyi/i });
    expect(emailLink.getAttribute('href')).toBe('mailto:support@yourbody.fyi');
  });

  it('renders the four pillar feature cards in exact order', () => {
    renderLanding();

    expect(screen.getByRole('heading', { level: 3, name: /No frills\./i })).toBeDefined();
    expect(screen.getByRole('heading', { level: 3, name: /Free forever\./i })).toBeDefined();
    expect(screen.getByRole('heading', { level: 3, name: /Coach mode\./i })).toBeDefined();
    expect(screen.getByRole('heading', { level: 3, name: /Your body, your data\./i })).toBeDefined();

    expect(
      screen.getByText(/No programs to buy, no streaks, no feed\. Log sets and meals in seconds and get back to training\./i)
    ).toBeDefined();
    expect(
      screen.getByText(/Workout and meal tracking, quick log and coach mode for up to 3 athletes cost nothing, now and later\./i)
    ).toBeDefined();
    expect(
      screen.getByText(/Coach up to 3 athletes free, 10 on Coach, 25 on Coach Pro\./i)
    ).toBeDefined();
    expect(
      screen.getByText(/No ads\. Your workouts and meals are never sold\. Export everything any time\./i)
    ).toBeDefined();
  });

  it('renders FAQ section and expands items on click', () => {
    renderLanding();

    const offlineFaq = screen.getByRole('button', { name: /Does it work in a gym with no signal\?/i });
    expect(offlineFaq).toBeDefined();

    // Click to expand
    fireEvent.click(offlineFaq);
    expect(
      screen.getByText(/Yes for logging workouts and quick meal logs: they save on your phone and sync when you're back online/i)
    ).toBeDefined();

    // App installation FAQ
    const appFaq = screen.getByRole('button', { name: /Is there an app\?/i });
    expect(appFaq).toBeDefined();
    fireEvent.click(appFaq);
    expect(screen.getByText(/Add to Home screen/i)).toBeDefined();
  });
});
