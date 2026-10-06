import { test, expect } from '@playwright/test';

test.describe('Error States & Retry Affordance E2E', () => {

  test('Route 1: /workout displays error state and retry affordance on PostgREST read error, recovering on retry', async ({ page }) => {
    // 1. Authenticate as athlete
    await page.goto('/login');
    await page.fill('input[type="email"]', 'athlete@yourbody.fyi');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/workout');

    // 2. Intercept PostgREST read query with 400 Bad Request
    await page.route('**/rest/v1/workouts*', (route) =>
      route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'synthetic PostgREST 400 error', code: '42703' }),
      })
    );

    // 3. Navigate to /workout and assert error state replacing empty state
    await page.goto('/workout');
    await expect(page.locator('[data-testid="workout-logs-error"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="retry-logs-btn"]')).toBeVisible();
    await expect(page.locator('text=No workout sessions recorded yet.')).not.toBeVisible();

    // 4. Clear route intercept, trigger retry affordance, and assert recovery
    await page.unroute('**/rest/v1/workouts*');
    await page.click('[data-testid="retry-logs-btn"]');
    await expect(page.locator('[data-testid="workout-logs-error"]')).not.toBeVisible({ timeout: 10000 });
  });

  test('Route 2: /history displays error state and retry affordance on PostgREST read error, recovering on retry', async ({ page }) => {
    // 1. Authenticate as athlete
    await page.goto('/login');
    await page.fill('input[type="email"]', 'athlete@yourbody.fyi');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/workout');

    // 2. Intercept PostgREST history read query with 400 Bad Request (v2 RPC)
    await page.route('**/rest/v1/rpc/get_history_sessions_v2*', (route) =>
      route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'synthetic PostgREST 400 error', code: '42703' }),
      })
    );

    // 3. Navigate to /history and assert error testid visible and empty state copy absent
    await page.goto('/history');
    await expect(page.locator('[data-testid="history-read-error"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="retry-history-btn"]')).toBeVisible();
    await expect(page.locator('text=No workout sessions recorded yet.')).not.toBeVisible();

    // 4. Clear intercept, click retry, and assert recovery
    await page.unroute('**/rest/v1/rpc/get_history_sessions_v2*');
    await page.click('[data-testid="retry-history-btn"]');
    await expect(page.locator('[data-testid="history-read-error"]')).not.toBeVisible({ timeout: 10000 });
  });

  test('Route 3: /nutrition displays error state and retry affordance on PostgREST read error, recovering on retry', async ({ page }) => {
    // 1. Authenticate as athlete
    await page.goto('/login');
    await page.fill('input[type="email"]', 'athlete@yourbody.fyi');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/workout');

    // 2. Intercept PostgREST nutrition_logs read query with 400 Bad Request
    await page.route('**/rest/v1/nutrition_logs*', (route) =>
      route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'synthetic PostgREST 400 error', code: '42703' }),
      })
    );

    // 3. Navigate to /nutrition and assert error testid visible and empty state copy absent
    await page.goto('/nutrition');
    await expect(page.locator('[data-testid="nutrition-read-error"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="retry-nutrition-btn"]')).toBeVisible();
    await expect(page.locator('text=No meals logged for this date yet.')).not.toBeVisible();

    // 4. Clear intercept, click retry, and assert recovery
    await page.unroute('**/rest/v1/nutrition_logs*');
    await page.click('[data-testid="retry-nutrition-btn"]');
    await expect(page.locator('[data-testid="nutrition-read-error"]')).not.toBeVisible({ timeout: 10000 });
  });

  test('Route 4: /exercises displays error state and retry affordance on PostgREST read error, recovering on retry', async ({ page }) => {
    // 1. Authenticate as athlete
    await page.goto('/login');
    await page.fill('input[type="email"]', 'athlete@yourbody.fyi');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/workout');

    // 2. Intercept PostgREST exercises read query with 400 Bad Request
    await page.route('**/rest/v1/exercises*', (route) =>
      route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'synthetic PostgREST 400 error', code: '42703' }),
      })
    );

    // 3. Navigate to /exercises and assert error testid visible and empty state copy absent
    await page.goto('/exercises');
    await expect(page.locator('[data-testid="exercises-read-error"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="retry-exercises-btn"]')).toBeVisible();
    await expect(page.locator('text=No exercises found in your library.')).not.toBeVisible();

    // 4. Clear intercept, click retry, and assert recovery
    await page.unroute('**/rest/v1/exercises*');
    await page.click('[data-testid="retry-exercises-btn"]');
    await expect(page.locator('[data-testid="exercises-read-error"]')).not.toBeVisible({ timeout: 10000 });
  });

  test('Route 5: /coach displays error state and retry affordance on PostgREST read error, recovering on retry', async ({ page }) => {
    // 1. Authenticate as coach
    await page.goto('/login');
    await page.fill('input[type="email"]', 'coach@yourbody.fyi');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/coach');

    // 2. Intercept PostgREST routine_templates read query with 400 Bad Request
    await page.route('**/rest/v1/routine_templates*', (route) =>
      route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'synthetic PostgREST 400 error', code: '42703' }),
      })
    );

    // 3. Navigate to /coach and assert error testid visible and empty state copy absent
    await page.goto('/coach');
    await expect(page.locator('[data-testid="coach-read-error"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="retry-coach-btn"]')).toBeVisible();
    await expect(page.locator('text=No workout templates created yet.')).not.toBeVisible();

    // 4. Clear intercept, click retry, and assert recovery
    await page.unroute('**/rest/v1/routine_templates*');
    await page.click('[data-testid="retry-coach-btn"]');
    await expect(page.locator('[data-testid="coach-read-error"]')).not.toBeVisible({ timeout: 10000 });
  });
});
