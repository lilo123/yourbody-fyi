import { test, expect } from '@playwright/test';

test.describe('Landing Page & Root Route Decisions', () => {
  test('logged-out visitor at / sees landing page and CTA navigates to signup', async ({ page }) => {
    await page.goto('/');

    // 1. Landing headline is visible
    const headline = page.getByRole('heading', {
      level: 1,
      name: /Track workouts and meals\. Even without signal\./i,
    });
    await expect(headline).toBeVisible();

    // 2. Sections and facts are visible
    await expect(page.getByText('Works without Wi-Fi')).toBeVisible();
    await expect(page.getByText('AI photo meal logging')).toBeVisible();
    await expect(page.getByText('Private & ad-free')).toBeVisible();

    // 3. Paid tiers show "Coming soon"
    const comingSoonBadges = page.locator('text=Coming soon');
    expect(await comingSoonBadges.count()).toBeGreaterThanOrEqual(3);

    // 4. Click primary "Start free" CTA
    const startFreeCta = page.getByRole('link', { name: 'Start free' }).first();
    await expect(startFreeCta).toBeVisible();
    await startFreeCta.click();

    // 5. Navigates to signup mode on login view
    await page.waitForURL('**/login?mode=signup');
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Register' })).toBeVisible();
  });

  test('visitor at / in standalone mode does not see landing and redirects', async ({ page }) => {
    // Emulate display-mode: standalone before navigation
    await page.addInitScript(() => {
      const originalMatchMedia = window.matchMedia;
      window.matchMedia = (query: string) => {
        if (query === '(display-mode: standalone)') {
          return {
            matches: true,
            media: query,
            onchange: null,
            addListener: () => {},
            removeListener: () => {},
            addEventListener: () => {},
            removeEventListener: () => {},
            dispatchEvent: () => false,
          } as unknown as MediaQueryList;
        }
        return originalMatchMedia ? originalMatchMedia.call(window, query) : ({
          matches: false,
          media: query,
          onchange: null,
          addListener: () => {},
          removeListener: () => {},
          addEventListener: () => {},
          removeEventListener: () => {},
          dispatchEvent: () => false,
        } as unknown as MediaQueryList);
      };
    });

    await page.goto('/');

    // Must NOT display the landing page headline
    const headline = page.getByRole('heading', {
      level: 1,
      name: /Track workouts and meals\. Even without signal\./i,
    });
    await expect(headline).not.toBeVisible();

    // Standalone root route redirects unauthenticated user to /login
    await page.waitForURL('**/login');
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign In' }).first()).toBeVisible();
  });

  test('landing page footer contains support email mailto link and legal routes', async ({ page }) => {
    await page.goto('/');

    const supportLink = page.locator('a[href="mailto:support@yourbody.fyi"]');
    await expect(supportLink).toBeVisible();

    const termsLink = page.locator('a[href="/terms"]');
    await expect(termsLink).toBeVisible();

    const privacyLink = page.locator('a[href="/privacy"]');
    await expect(privacyLink).toBeVisible();

    const refundsLink = page.locator('a[href="/refunds"]');
    await expect(refundsLink).toBeVisible();
  });
});
