import { test, expect } from '@playwright/test';

test.describe('Landing Page & Root Route Decisions', () => {
  test('logged-out visitor at / sees landing page and CTA navigates to signup', async ({ page }) => {
    await page.goto('/');

    // 1. Landing headline is visible
    const headline = page.getByRole('heading', {
      level: 1,
      name: /You know your workout\. We just help you track it\./i,
    });
    await expect(headline).toBeVisible();

    // 2. App header must NOT be present on logged-out landing
    await expect(page.locator('[data-testid="app-header"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="connection-status"]')).not.toBeVisible();

    // 3. Four pillar feature cards are visible
    await expect(page.getByRole('heading', { level: 3, name: 'No frills.' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 3, name: 'Free forever.' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 3, name: 'Coach mode.' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 3, name: 'Your body, your data.' })).toBeVisible();

    // 4. FAQ entries are present
    await expect(page.getByRole('button', { name: /Does it work in a gym with no signal\?/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Is there an app\?/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /How does the AI trial work\?/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Can my clients use it for free\?/i })).toBeVisible();

    // 5. Paid tiers show "Coming soon"
    const comingSoonBadges = page.locator('text=Coming soon');
    expect(await comingSoonBadges.count()).toBeGreaterThanOrEqual(3);

    // 6. Primary CTA href and navigation
    const startFreeCta = page.getByRole('link', { name: 'Start free' }).first();
    await expect(startFreeCta).toBeVisible();
    await expect(startFreeCta).toHaveAttribute('href', '/login?mode=signup');
    await startFreeCta.click();

    // 7. Navigates to signup mode on login view
    await page.waitForURL('**/login?mode=signup');
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Register' })).toBeVisible();

    // App header IS present on login / app routes
    await expect(page.locator('[data-testid="app-header"]')).toBeVisible();

    // 8. Logo on login view links to / and navigates back to landing
    const logoLink = page.getByRole('link', { name: 'Yourbody.fyi Home' }).first();
    await expect(logoLink).toBeVisible();
    await expect(logoLink).toHaveAttribute('href', '/');
    await logoLink.click();
    await expect(headline).toBeVisible();
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
      name: /You know your workout\. We just help you track it\./i,
    });
    await expect(headline).not.toBeVisible();

    // Standalone root route redirects unauthenticated user to /login
    await page.waitForURL('**/login');
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign In' }).first()).toBeVisible();

    // App header IS present on the app route
    await expect(page.locator('[data-testid="app-header"]')).toBeVisible();
  });

  test('signed-in visitor with default route opens / on fresh page and renders workout content', async ({ page, context }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', 'athlete@yourbody.fyi');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/workout');
    await expect(page.locator('[data-testid="routine-select-btn"]')).toBeVisible({ timeout: 5000 });

    const freshPage = await context.newPage();
    try {
      await freshPage.goto('/');
      await expect(freshPage).toHaveURL(/\/workout/, { timeout: 5000 });
      await expect(freshPage.locator('[data-testid="routine-select-btn"]')).toBeVisible({ timeout: 5000 });
    } finally {
      await freshPage.close();
    }
  });

  test('signed-in visitor with last route /nutrition opens / on fresh page and renders nutrition content', async ({ page, context }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', 'athlete@yourbody.fyi');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/workout');
    await expect(page.locator('[data-testid="routine-select-btn"]')).toBeVisible({ timeout: 5000 });

    await page.click('[data-testid="nav-nutrition"]');
    await page.waitForURL('**/nutrition');
    await expect(page.locator('[data-testid="nutrition-date-input"]')).toBeVisible({ timeout: 5000 });

    const freshPage = await context.newPage();
    try {
      await freshPage.goto('/');
      await expect(freshPage).toHaveURL(/\/nutrition/, { timeout: 5000 });
      await expect(freshPage.locator('[data-testid="nutrition-date-input"]')).toBeVisible({ timeout: 5000 });
    } finally {
      await freshPage.close();
    }
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

    const signInLink = page.getByRole('link', { name: 'Sign in' }).first();
    await expect(signInLink).toHaveAttribute('href', '/login');
  });

  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 1920, height: 1080 },
  ]) {
    test(`desktop layout check at ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');

      // 1. Landing main container width >= 1000px
      const mainContainer = page.locator('[data-testid="landing-main-container"]');
      await expect(mainContainer).toBeVisible();
      const containerBox = await mainContainer.boundingBox();
      expect(containerBox).not.toBeNull();
      expect(containerBox!.width).toBeGreaterThanOrEqual(1000);

      // 2. Exactly one header/banner landmark on '/'
      const headers = page.locator('header');
      await expect(headers).toHaveCount(1);

      // 3. Every pricing card width >= 240px
      const pricingCards = page.locator('[data-testid="pricing-card"]');
      const cardCount = await pricingCards.count();
      expect(cardCount).toBe(4);
      for (let i = 0; i < cardCount; i++) {
        const cardBox = await pricingCards.nth(i).boundingBox();
        expect(cardBox).not.toBeNull();
        expect(cardBox!.width).toBeGreaterThanOrEqual(240);
      }
    });
  }

  test('mobile layout at 390x844 has no horizontal scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const hasHorizontalOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth;
    });
    expect(hasHorizontalOverflow).toBe(false);
  });

  test('interactive hero demo logs set and appends new set row', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const logSetBtn = page.getByRole('button', { name: 'Log set' });
    await expect(logSetBtn).toBeVisible();

    await expect(page.getByRole('button', { name: 'Toggle set 3' })).toHaveCount(0);

    await logSetBtn.click();

    await expect(page.getByRole('button', { name: 'Toggle set 3' })).toBeVisible();
    await expect(page.getByText('225 lbs × 4 reps')).toBeVisible();

    const liveRegion = page.locator('output[aria-live="polite"]');
    await expect(liveRegion).toContainText('Set 3 logged: 225 lbs x 4');
  });

  test('interactive hero demo at 390x844 logs set and shows new row', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const logSetBtn = page.getByRole('button', { name: 'Log set' });
    await expect(logSetBtn).toBeVisible();

    await logSetBtn.click();

    await expect(page.getByRole('button', { name: 'Toggle set 3' })).toBeVisible();
    await expect(page.getByText('225 lbs × 4 reps')).toBeVisible();
  });

  test('capture demo screenshot at 1440', async ({ page }, testInfo) => {
    if (testInfo.project.name !== 'Desktop Chrome') return;
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const logSetBtn = page.getByRole('button', { name: 'Log set' });
    await expect(logSetBtn).toBeVisible();
    await logSetBtn.click();
    await expect(page.getByRole('button', { name: 'Toggle set 3' })).toBeVisible();

    const hero = page.locator('[data-testid="landing-main-container"]');
    await hero.screenshot({ path: '/tmp/demo-1440-raw.png' });
  });
});
