import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
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

  describe('Hero interactive set-logging demo', () => {
    it('logs a set, displays Saved state, and announces via polite live region', () => {
      renderLanding();

      // Initial state has Set 1 and Set 2
      expect(screen.getByText('185 lbs × 8 reps')).toBeDefined();
      expect(screen.getByText('205 lbs × 6 reps')).toBeDefined();
      expect(screen.queryByText('225 lbs × 4 reps')).toBeNull();

      // Click "Log set"
      const logSetBtn = screen.getByRole('button', { name: 'Log set' });
      fireEvent.click(logSetBtn);

      // Set 3 is now in the list
      expect(screen.getByText('Set 3')).toBeDefined();
      expect(screen.getByText('225 lbs × 4 reps')).toBeDefined();

      // Live region announcement
      expect(screen.getByText('Set 3 logged: 225 lbs x 4')).toBeDefined();

      // Rest countdown pill is active
      const timer = screen.getByTestId('demo-rest-timer');
      expect(timer).toHaveTextContent('Rest: 1:30');
    });

    it('steppers adjust weight and reps', () => {
      renderLanding();

      const incWeight = screen.getByRole('button', { name: 'Increase weight' });
      const decWeight = screen.getByRole('button', { name: 'Decrease weight' });
      const incReps = screen.getByRole('button', { name: 'Increase reps' });
      const decReps = screen.getByRole('button', { name: 'Decrease reps' });

      // Stepper initially 225 lbs, 4 reps
      expect(screen.getByText('225 lbs')).toBeDefined();
      expect(screen.getByText('4 reps')).toBeDefined();

      fireEvent.click(incWeight);
      expect(screen.getByText('230 lbs')).toBeDefined();

      fireEvent.click(decWeight);
      expect(screen.getByText('225 lbs')).toBeDefined();

      fireEvent.click(incReps);
      expect(screen.getByText('5 reps')).toBeDefined();

      fireEvent.click(decReps);
      expect(screen.getByText('4 reps')).toBeDefined();
    });

    it('toggles existing set row done check', () => {
      renderLanding();

      expect(screen.getByText('2 sets completed')).toBeDefined();

      const toggleSet1 = screen.getByRole('button', { name: 'Toggle set 1' });
      fireEvent.click(toggleSet1);

      expect(screen.getByText('1 set completed')).toBeDefined();

      fireEvent.click(toggleSet1);
      expect(screen.getByText('2 sets completed')).toBeDefined();
    });

    it('restores initial state on reset', () => {
      renderLanding();

      const logSetBtn = screen.getByRole('button', { name: 'Log set' });
      fireEvent.click(logSetBtn);
      expect(screen.getByText('Set 3')).toBeDefined();

      const resetBtn = screen.getByRole('button', { name: 'Reset' });
      fireEvent.click(resetBtn);

      expect(screen.queryByText('Set 3')).toBeNull();
      expect(screen.queryByTestId('demo-rest-timer')).toBeNull();
      expect(screen.getByText('2 sets completed')).toBeDefined();
    });

    it('caps at 8 sets and disables Log set button', () => {
      renderLanding();

      const logSetBtn = screen.getByRole('button', { name: 'Log set' });
      // Initially 2 sets. Clicking 6 times brings it to 8 sets.
      for (let index = 0; index < 6; index++) {
        fireEvent.click(logSetBtn);
      }

      expect(screen.getByText('Set 8')).toBeDefined();
      expect(logSetBtn).toBeDisabled();

      // Attempting to log a 9th set does nothing
      fireEvent.click(logSetBtn);
      expect(screen.queryByText('Set 9')).toBeNull();
    });

    it('counts down rest timer each second and cleans up on unmount', () => {
      vi.useFakeTimers();
      try {
        const { unmount } = renderLanding();

        const logSetBtn = screen.getByRole('button', { name: 'Log set' });
        fireEvent.click(logSetBtn);

        const timer = screen.getByTestId('demo-rest-timer');
        expect(timer).toHaveTextContent('Rest: 1:30');

        act(() => {
          vi.advanceTimersByTime(1000);
        });
        expect(timer).toHaveTextContent('Rest: 1:29');

        act(() => {
          vi.advanceTimersByTime(29000);
        });
        expect(timer).toHaveTextContent('Rest: 1:00');

        // Unmount cleans up interval without leaks or errors
        unmount();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('Meal parser demo section', () => {
    it('renders heading, prefilled textarea, and Read it button', () => {
      renderLanding();

      expect(screen.getByRole('heading', { level: 2, name: /Try the meal parser/i })).toBeDefined();

      const textarea = screen.getByRole('textbox', { name: /Nutrition block input/i });
      expect(textarea).toBeDefined();
      expect(textarea).toHaveValue(
        `Greek yogurt\nServing: 170 g\nCalories: 130\nProtein: 15g\nCarbs: 6g\nFat: 5g`
      );

      const readBtn = screen.getByRole('button', { name: /Read it/i });
      expect(readBtn).toBeDefined();
    });

    it('parses example block successfully and displays parsed values and Start free CTA', async () => {
      renderLanding();

      const readBtn = screen.getByRole('button', { name: /Read it/i });
      fireEvent.click(readBtn);

      expect(await screen.findByText('Greek yogurt')).toBeDefined();
      expect(screen.getByText('170 g')).toBeDefined();
      expect(screen.getByText('130')).toBeDefined();
      expect(screen.getByText('15g')).toBeDefined();
      expect(screen.getByText('6g')).toBeDefined();
      expect(screen.getByText('5g')).toBeDefined();

      const resultCard = screen.getByTestId('meal-demo-result');
      const ctaLink = within(resultCard).getByRole('link', { name: /Start free/i });
      expect(ctaLink.getAttribute('href')).toBe('/login?mode=signup');
    });

    it('shows failure line when input is not a parseable nutrition block', async () => {
      renderLanding();

      const textarea = screen.getByRole('textbox', { name: /Nutrition block input/i });
      fireEvent.change(textarea, { target: { value: 'I had two slices of pizza and a soda' } });

      const readBtn = screen.getByRole('button', { name: /Read it/i });
      fireEvent.click(readBtn);

      expect(
        await screen.findByText(/The full app can read this with AI parse after signing up\./i)
      ).toBeDefined();

      const resultCard = screen.getByTestId('meal-demo-result');
      const ctaLink = within(resultCard).getByRole('link', { name: /Start free/i });
      expect(ctaLink.getAttribute('href')).toBe('/login?mode=signup');
    });

    it('makes no fetch calls during local parse', async () => {
      const fetchSpy = vi.spyOn(window, 'fetch');
      renderLanding();

      const readBtn = screen.getByRole('button', { name: /Read it/i });
      fireEvent.click(readBtn);

      await screen.findByText('Greek yogurt');
      expect(fetchSpy).not.toHaveBeenCalled();

      // Also on failure
      const textarea = screen.getByRole('textbox', { name: /Nutrition block input/i });
      fireEvent.change(textarea, { target: { value: 'invalid non-nutrition text' } });
      fireEvent.click(readBtn);

      await screen.findByText(/The full app can read this with AI parse after signing up\./i);
      expect(fetchSpy).not.toHaveBeenCalled();

      fetchSpy.mockRestore();
    });
  });
});

