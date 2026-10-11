import { test, expect, type Page } from '@playwright/test';

interface MockEntitlementOptions {
  plan?: string;
  planEffective?: string;
  paidUntil?: string | null;
  trialEndsAt?: string | null;
  hasPro?: boolean;
}

/**
 * Intercepts app_config read (src/hooks/useFeatureFlag.ts:31-34) to force
 * paywall_enabled to true (or false) in the browser test environment only.
 */
async function mockPaywallFeatureFlag(page: Page, enabled = true) {
  await page.route('**/rest/v1/app_config*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          key: 'paywall_enabled',
          value: enabled,
          description: 'Enables paywall UI, upgrade prompts, and subscription settings cards.',
        },
        {
          key: 'ai_quota_enabled',
          value: false,
          description: 'Enforce AI parse quotas in parse-nutrition',
        },
        {
          key: 'account_deletion_enabled',
          value: true,
          description: 'Enables user account deletion feature.',
        },
      ]),
    });
  });
}

/**
 * Intercepts get_my_entitlement RPC (src/hooks/useEntitlement.ts:53).
 */
async function mockEntitlement(page: Page, options: MockEntitlementOptions) {
  const payload = {
    plan: options.plan ?? 'free',
    plan_effective: options.planEffective ?? options.plan ?? 'free',
    paid_until: options.paidUntil ?? null,
    trial_ends_at_effective: options.trialEndsAt ?? null,
    has_pro: options.hasPro ?? false,
  };

  await page.route('**/rest/v1/rpc/get_my_entitlement*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(payload),
    });
  });
}

/**
 * Intercepts my_coach_limits RPC (src/components/settings/SubscriptionCard.tsx:74).
 */
async function mockCoachLimits(page: Page, athleteCount: number, athleteLimit: number) {
  await page.route('**/rest/v1/rpc/my_coach_limits*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ athlete_count: athleteCount, athlete_limit: athleteLimit }]),
    });
  });
}

/**
 * Intercepts user profile query from public.users to override coach_tier.
 */
async function mockUserCoachTier(page: Page, tier: string) {
  await page.route('**/rest/v1/users*', async (route) => {
    const request = route.request();
    if (request.method() === 'GET') {
      const response = await route.fetch();
      const json = await response.json();
      if (Array.isArray(json)) {
        for (const item of json) {
          item.coach_tier = tier;
        }
      } else if (json && typeof json === 'object') {
        json.coach_tier = tier;
      }
      await route.fulfill({
        response,
        json,
      });
    } else {
      await route.continue();
    }
  });
}

/**
 * Authenticates as the standard seeded athlete account.
 */
async function loginAsAthlete(page: Page) {
  await page.goto('/login');
  await page.fill('input[type="email"]', 'athlete@yourbody.fyi');
  await page.fill('input[type="password"]', 'password123');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/workout');
}

test.describe('Paywall & Subscription Flows E2E', () => {
  test('Case A: quota-exceeded in nutrition shows Upgrade action that opens UpgradeSheet with tiers and pricing toggle', async ({
    page,
  }) => {
    await mockPaywallFeatureFlag(page, true);
    await mockEntitlement(page, { plan: 'free', hasPro: false });

    // Mock parse-nutrition edge function responding with 429 quota_exceeded
    await page.route('**/functions/v1/parse-nutrition', async (route) => {
      await route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 'quota_exceeded',
          error: "AI parsing isn't included in the free plan. Quick log and on-device parsing stay free.",
          plan: 'free',
          limit: 0,
          used: 0,
          period: 'month',
        }),
      });
    });

    await loginAsAthlete(page);
    await page.goto('/nutrition');
    await page.waitForURL('**/nutrition');

    const mealInput = page.locator('textarea[placeholder*="Describe what you ate"]');
    await expect(mealInput).toBeVisible();
    await mealInput.fill('grilled chicken with sweet potato and broccoli');

    await page.click('[data-testid="analyze-meal-button"]');

    // Quota-exceeded error message banner is displayed
    const statusBanner = page.locator('[data-testid="status-message"]');
    await expect(statusBanner).toBeVisible();
    await expect(statusBanner).toContainText("AI parsing isn't included in the free plan");

    // Upgrade action button is rendered inside banner
    const upgradeBtn = page.locator('[data-testid="ai-upgrade-btn"]');
    await expect(upgradeBtn).toBeVisible();
    await expect(upgradeBtn).toHaveText('Upgrade');

    // Clicking Upgrade action opens UpgradeSheet
    await upgradeBtn.click();
    const upgradeSheet = page.locator('[data-testid="upgrade-sheet"]');
    await expect(upgradeSheet).toBeVisible();

    // All three tiers are present
    const personalCard = page.locator('[data-testid="plan-card-personal"]');
    const coachCard = page.locator('[data-testid="plan-card-coach"]');
    const coachProCard = page.locator('[data-testid="plan-card-coach_pro"]');
    await expect(personalCard).toBeVisible();
    await expect(coachCard).toBeVisible();
    await expect(coachProCard).toBeVisible();

    // Yearly is preselected by default
    const yearToggle = page.locator('[data-testid="interval-toggle-year"]');
    const monthToggle = page.locator('[data-testid="interval-toggle-month"]');
    await expect(yearToggle).toHaveAttribute('aria-checked', 'true');
    await expect(monthToggle).toHaveAttribute('aria-checked', 'false');

    await expect(personalCard).toContainText('$10/yr');
    await expect(coachCard).toContainText('$40/yr');
    await expect(coachProCard).toContainText('$80/yr');

    // Toggle to monthly updates prices
    await monthToggle.click();
    await expect(monthToggle).toHaveAttribute('aria-checked', 'true');
    await expect(yearToggle).toHaveAttribute('aria-checked', 'false');

    await expect(personalCard).toContainText('$2/mo');
    await expect(coachCard).toContainText('$5/mo');
    await expect(coachProCard).toContainText('$10/mo');

    // Toggle back to yearly updates prices back
    await yearToggle.click();
    await expect(yearToggle).toHaveAttribute('aria-checked', 'true');
    await expect(personalCard).toContainText('$10/yr');
    await expect(coachCard).toContainText('$40/yr');
    await expect(coachProCard).toContainText('$80/yr');
  });

  test('Case B: choosing a tier calls create-checkout with {plan, interval} and redirects to returned URL', async ({
    page,
  }) => {
    await mockPaywallFeatureFlag(page, true);
    await mockEntitlement(page, { plan: 'free', hasPro: false });

    let recordedCheckoutBody: { plan?: string; interval?: string } | null = null;
    await page.route('**/functions/v1/create-checkout', async (route) => {
      recordedCheckoutBody = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          url: 'https://checkout.stripe.test/c/pay/mock_cs_coach_month',
        }),
      });
    });

    await page.route('https://checkout.stripe.test/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!DOCTYPE html><html><body><h1>Stripe Checkout Stub</h1></body></html>',
      });
    });

    await loginAsAthlete(page);
    await page.goto('/settings');
    await page.waitForURL('**/settings');

    await page.click('[data-testid="subscription-upgrade-btn"]');
    await expect(page.locator('[data-testid="upgrade-sheet"]')).toBeVisible();

    // Toggle to monthly interval
    await page.click('[data-testid="interval-toggle-month"]');

    // Choose Coach tier
    await page.click('[data-testid="upgrade-plan-coach-btn"]');

    // Browser is redirected to the returned checkout URL
    await page.waitForURL('https://checkout.stripe.test/**');
    expect(recordedCheckoutBody).toEqual({ plan: 'coach', interval: 'month' });
    await expect(page.locator('h1')).toHaveText('Stripe Checkout Stub');
  });

  test('Case C-1: Settings Subscription card displays Free state with Upgrade action', async ({
    page,
  }) => {
    await mockPaywallFeatureFlag(page, true);
    await mockEntitlement(page, {
      plan: 'free',
      planEffective: 'free',
      hasPro: false,
      paidUntil: null,
      trialEndsAt: null,
    });

    await loginAsAthlete(page);
    await page.goto('/settings');
    await page.waitForURL('**/settings');

    const card = page.locator('[data-testid="subscription-card"]');
    await expect(card).toBeVisible();

    const badge = page.locator('[data-testid="subscription-plan-badge"]');
    await expect(badge).toHaveText('Free');

    await expect(page.locator('[data-testid="subscription-upgrade-btn"]')).toBeVisible();
    await expect(page.locator('[data-testid="subscription-manage-billing-btn"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="subscription-athletes-count"]')).not.toBeVisible();
  });

  test('Case C-2: Settings Subscription card displays Trial state with Upgrade action', async ({
    page,
  }) => {
    await mockPaywallFeatureFlag(page, true);
    await mockEntitlement(page, {
      plan: 'trial',
      planEffective: 'trial',
      hasPro: false,
      paidUntil: null,
      trialEndsAt: '2030-01-01T00:00:00Z',
    });

    await loginAsAthlete(page);
    await page.goto('/settings');
    await page.waitForURL('**/settings');

    const badge = page.locator('[data-testid="subscription-plan-badge"]');
    await expect(badge).toHaveText('Trial');

    await expect(page.locator('[data-testid="subscription-upgrade-btn"]')).toBeVisible();
    await expect(page.locator('[data-testid="subscription-manage-billing-btn"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="subscription-athletes-count"]')).not.toBeVisible();
  });

  test('Case C-3: Settings Subscription card displays Personal state with Upgrade and Manage billing', async ({
    page,
  }) => {
    await mockPaywallFeatureFlag(page, true);
    await mockEntitlement(page, {
      plan: 'basic',
      planEffective: 'basic',
      hasPro: false,
      paidUntil: '2030-01-01T00:00:00Z',
      trialEndsAt: null,
    });

    await loginAsAthlete(page);
    await page.goto('/settings');
    await page.waitForURL('**/settings');

    const badge = page.locator('[data-testid="subscription-plan-badge"]');
    await expect(badge).toHaveText('Personal');

    await expect(page.locator('[data-testid="subscription-upgrade-btn"]')).toBeVisible();
    await expect(page.locator('[data-testid="subscription-manage-billing-btn"]')).toBeVisible();
    await expect(page.locator('[data-testid="subscription-athletes-count"]')).not.toBeVisible();
  });

  test('Case C-4: Settings Subscription card displays Coach state with N / 10 athletes count', async ({
    page,
  }) => {
    await mockPaywallFeatureFlag(page, true);
    await mockEntitlement(page, {
      plan: 'pro',
      planEffective: 'pro',
      hasPro: true,
      paidUntil: '2030-01-01T00:00:00Z',
      trialEndsAt: null,
    });
    await mockCoachLimits(page, 4, 10);

    await loginAsAthlete(page);
    await page.goto('/settings');
    await page.waitForURL('**/settings');

    const badge = page.locator('[data-testid="subscription-plan-badge"]');
    await expect(badge).toHaveText('Coach');

    const athletesCount = page.locator('[data-testid="subscription-athletes-count"]');
    await expect(athletesCount).toBeVisible();
    await expect(athletesCount).toHaveText('4 / 10 athletes');

    await expect(page.locator('[data-testid="subscription-upgrade-btn"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="subscription-manage-billing-btn"]')).toBeVisible();
  });

  test('Case C-5: Settings Subscription card displays Coach Pro state with N / 25 athletes, and Manage billing calls create-portal-session', async ({
    page,
  }) => {
    await mockPaywallFeatureFlag(page, true);
    await mockEntitlement(page, {
      plan: 'pro',
      planEffective: 'pro',
      hasPro: true,
      paidUntil: '2030-01-01T00:00:00Z',
      trialEndsAt: null,
    });
    await mockUserCoachTier(page, 'enterprise');
    await mockCoachLimits(page, 11, 25);

    let portalCalled = false;
    await page.route('**/functions/v1/create-portal-session', async (route) => {
      portalCalled = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          url: 'https://billing.stripe.test/session/mock_portal_123',
        }),
      });
    });

    await page.route('https://billing.stripe.test/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!DOCTYPE html><html><body><h1>Stripe Billing Portal Stub</h1></body></html>',
      });
    });

    await loginAsAthlete(page);
    await page.goto('/settings');
    await page.waitForURL('**/settings');

    const badge = page.locator('[data-testid="subscription-plan-badge"]');
    await expect(badge).toHaveText('Coach Pro');

    const athletesCount = page.locator('[data-testid="subscription-athletes-count"]');
    await expect(athletesCount).toBeVisible();
    await expect(athletesCount).toHaveText('11 / 25 athletes');

    await expect(page.locator('[data-testid="subscription-upgrade-btn"]')).not.toBeVisible();

    const manageBillingBtn = page.locator('[data-testid="subscription-manage-billing-btn"]');
    await expect(manageBillingBtn).toBeVisible();

    await manageBillingBtn.click();
    await page.waitForURL('https://billing.stripe.test/**');
    expect(portalCalled).toBe(true);
    await expect(page.locator('h1')).toHaveText('Stripe Billing Portal Stub');
  });
});
