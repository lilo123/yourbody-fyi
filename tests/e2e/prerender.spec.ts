import { test, expect } from '@playwright/test';

test.describe('Prerender Guard & Cold Load Invariants', () => {
  test('signed-in cold load of / polls DOM every 50 ms and never sees landing text (5 loads)', async ({
    page,
    context,
  }) => {
    // 1. Initial sign-in to establish authenticated session
    await page.goto('/login');
    await page.fill('input[type="email"]', 'athlete@yourbody.fyi');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/workout');
    await expect(page.locator('[data-testid="routine-select-btn"]')).toBeVisible({ timeout: 10000 });

    // 2. Perform 5 consecutive fresh cold loads of '/'
    for (let iteration = 1; iteration <= 5; iteration++) {
      const freshPage = await context.newPage();
      try {
        // Install high-frequency DOM poller (50 ms interval from document_start)
        await freshPage.addInitScript(() => {
          (window as any).__landingTextObserved = false;
          (window as any).__observedSnippets = [];

          const inspect = () => {
            const body = document.body;
            if (!body) return;
            const text = body.innerText || '';
            const landingPatterns = [
              'You know your workout',
              'We just help you track it',
              'No frills.',
              'Free forever.',
              'Coach mode.',
              'Your body, your data.',
              'Try the meal parser',
              'Does it work in a gym with no signal?',
            ];
            for (const pattern of landingPatterns) {
              if (text.includes(pattern)) {
                const prerenderEl = document.getElementById('prerender');
                const isHidden = prerenderEl ? window.getComputedStyle(prerenderEl).display === 'none' : true;
                if (!isHidden) {
                  (window as any).__landingTextObserved = true;
                  (window as any).__observedSnippets.push({ pattern, time: performance.now() });
                }
              }
            }
          };

          inspect();
          const timer = setInterval(inspect, 50);
          window.addEventListener('load', () => {
            inspect();
            setTimeout(() => {
              inspect();
              clearInterval(timer);
            }, 1000);
          });
        });

        await freshPage.goto('/');

        // Cold load must navigate directly to workout route without landing flash
        await expect(freshPage).toHaveURL(/\/workout/, { timeout: 10000 });
        await expect(freshPage.locator('[data-testid="routine-select-btn"]')).toBeVisible({ timeout: 10000 });

        // Poller verdict: landing text was never observed
        const landingObserved = await freshPage.evaluate(() => (window as any).__landingTextObserved);
        expect(landingObserved, `Landing text flashed on cold load iteration ${iteration}`).toBe(false);

        // Confirm #prerender is not visible in DOM
        const prerender = freshPage.locator('#prerender');
        await expect(prerender).not.toBeVisible();
      } finally {
        await freshPage.close();
      }
    }
  });

  test('#prerender is hidden on /workout when served index.html shell', async ({ page }) => {
    // Visit /workout directly
    await page.goto('/workout');

    // The guard script must immediately apply hide-prerender on non-public path
    const hasGuardClass = await page.evaluate(() =>
      document.documentElement.classList.contains('hide-prerender')
    );
    expect(hasGuardClass).toBe(true);

    // #prerender must not be visible
    const prerender = page.locator('#prerender');
    await expect(prerender).not.toBeVisible();

    // Verify redirect or app shell behaviour
    await expect(page).toHaveURL(/\/(login|workout)/);
  });
});
