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

  test('signed-out cold load of / has CLS < 0.05 on desktop and mobile', async ({ page }) => {
    for (const viewport of [
      { width: 1280, height: 800 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await page.addInitScript(() => {
        (window as any).__cls = 0;
        try {
          new PerformanceObserver((entryList) => {
            for (const entry of entryList.getEntries()) {
              if (!(entry as any).hadRecentInput) {
                (window as any).__cls += (entry as any).value;
              }
            }
          }).observe({ type: 'layout-shift', buffered: true });
        } catch {}
      });

      await page.goto('/');
      await page.waitForFunction(() => !document.getElementById('prerender'), { timeout: 15000 });
      await page.waitForTimeout(300);

      const cls = await page.evaluate(() => (window as any).__cls);
      expect(cls).toBeLessThan(0.05);
    }
  });

  test('signed-out cold load of /terms has CLS < 0.05 on desktop and mobile', async ({ page }) => {
    for (const viewport of [
      { width: 1280, height: 800 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await page.addInitScript(() => {
        (window as any).__cls = 0;
        try {
          new PerformanceObserver((entryList) => {
            for (const entry of entryList.getEntries()) {
              if (!(entry as any).hadRecentInput) {
                (window as any).__cls += (entry as any).value;
              }
            }
          }).observe({ type: 'layout-shift', buffered: true });
        } catch {}
      });

      await page.goto('/terms');
      await page.waitForFunction(() => !document.getElementById('prerender'), { timeout: 15000 });
      await page.waitForTimeout(300);

      const cls = await page.evaluate(() => (window as any).__cls);
      expect(cls).toBeLessThan(0.05);
    }
  });

  test('/terms served from index.html (SW-fallback scenario) never shows the landing hero (poll every 50 ms)', async ({
    page,
  }) => {
    // Simulate SW navigateFallback: intercept /terms to return index.html shell containing prerendered landing
    await page.route('**/terms', async (route) => {
      const response = await page.request.get('/index.html');
      let body = await response.text();
      // Ensure the served shell carries the prerendered landing hero and route="/"
      if (!body.includes('data-prerender-route')) {
        body = body.replace(
          '<div id="prerender">',
          '<div id="prerender" data-prerender-route="/">'
        );
      }
      if (!body.includes('You know your workout')) {
        body = body.replace(
          /id="prerender"[^>]*>([\s\S]*?)<\/div>/,
          'id="prerender" data-prerender-route="/"><h1>You know your workout. We just help you track it.</h1><p>No frills. Free forever.</p></div>'
        );
      }
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
        body,
      });
    });

    // Install high-frequency poller (every 50 ms)
    await page.addInitScript(() => {
      (window as any).__landingHeroObserved = false;
      const inspect = () => {
        const prerender = document.getElementById('prerender');
        if (prerender && window.getComputedStyle(prerender).display !== 'none') {
          const text = prerender.innerText || '';
          if (
            text.includes('You know your workout') ||
            text.includes('We just help you track it') ||
            text.includes('No frills.') ||
            text.includes('Free forever.')
          ) {
            (window as any).__landingHeroObserved = true;
          }
        }
      };
      inspect();
      const timer = setInterval(inspect, 50);
      window.addEventListener('load', () => {
        setTimeout(() => clearInterval(timer), 1000);
      });
    });

    await page.goto('/terms');
    await expect(page.locator('h1', { hasText: 'Terms of Service' })).toBeVisible({ timeout: 10000 });

    const heroObserved = await page.evaluate(() => (window as any).__landingHeroObserved);
    expect(heroObserved, 'Landing hero flashed on /terms served from index.html').toBe(false);

    const prerender = page.locator('#prerender');
    await expect(prerender).not.toBeVisible();
  });
});
