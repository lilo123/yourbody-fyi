import { test, expect } from '@playwright/test';

test.describe('History Keyset Pagination Verification', () => {
  test('A user with 151 workouts reaches all 151 distinct sessions via keyset pagination with no duplicates', async ({ page }) => {
    test.setTimeout(60000);
    // 1. Authenticate as dedicated pagination user (151 seeded workouts)
    await page.goto('/login');
    await page.fill('input[type="email"]', 'paginate@yourbody.fyi');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/workout');

    // 2. Navigate to /history
    await page.goto('/history');
    await page.waitForURL('**/history');

    const countBanner = page.locator('[data-testid="showing-sessions-count"]');
    const loadMoreBtn = page.locator('[data-testid="load-more-sessions-btn"]');

    // Page 1: Keyset page size = 30 sessions, total = 151
    await expect(countBanner).toHaveText('Showing 30 of 151 sessions', { timeout: 10000 });
    await expect(loadMoreBtn).toBeVisible();
    await expect(loadMoreBtn).toHaveText('Load More Sessions (30 of 151)');

    // Page 2: 60 sessions
    await loadMoreBtn.click();
    await expect(countBanner).toHaveText('Showing 60 of 151 sessions', { timeout: 10000 });
    await expect(loadMoreBtn).toHaveText('Load More Sessions (60 of 151)');

    // Page 3: 90 sessions
    await loadMoreBtn.click();
    await expect(countBanner).toHaveText('Showing 90 of 151 sessions', { timeout: 10000 });
    await expect(loadMoreBtn).toHaveText('Load More Sessions (90 of 151)');

    // Page 4: 120 sessions
    await loadMoreBtn.click();
    await expect(countBanner).toHaveText('Showing 120 of 151 sessions', { timeout: 10000 });
    await expect(loadMoreBtn).toHaveText('Load More Sessions (120 of 151)');

    // Page 5: 150 sessions
    await loadMoreBtn.click();
    await expect(countBanner).toHaveText('Showing 150 of 151 sessions', { timeout: 10000 });
    await expect(loadMoreBtn).toHaveText('Load More Sessions (150 of 151)');

    // Page 6: 151 sessions (final page)
    await loadMoreBtn.click();
    await expect(countBanner).toHaveText('Showing 151 of 151 sessions', { timeout: 10000 });

    // Load More button must disappear once all items are loaded
    await expect(loadMoreBtn).not.toBeVisible();

    // 3. Virtualization-safe distinct session counting:
    // Scroll through the virtualized list from top to bottom, recording session names and ids.
    const seenNames = new Set<string>();
    const seenIds = new Set<string>();

    await page.evaluate(() => window.scrollTo(0, 0));

    let atBottom = false;
    let safetyCap = 0;
    while (!atBottom && safetyCap < 200) {
      safetyCap++;

      const { titles, ids } = await page.evaluate(() => {
        const foundTitles = Array.from(document.querySelectorAll('h3'))
          .map((h) => h.textContent?.trim() || '')
          .filter((t) => t.startsWith('Paginate Workout'));
        const foundIds = Array.from(document.querySelectorAll('button[data-testid^="expand-session-btn-"]'))
          .map((b) => b.getAttribute('data-testid')?.replace('expand-session-btn-', '') || '')
          .filter(Boolean);
        return { titles: foundTitles, ids: foundIds };
      });

      for (const t of titles) {
        seenNames.add(t);
      }
      for (const id of ids) {
        seenIds.add(id);
      }

      atBottom = await page.evaluate(
        () => window.innerHeight + window.scrollY >= document.body.scrollHeight - 2
      );

      if (!atBottom) {
        await page.evaluate(() => window.scrollBy(0, 500));
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      }
    }

    console.log(`[history-pagination] Distinct session names: ${seenNames.size}, Distinct session IDs: ${seenIds.size}`);

    // All 151 sessions are present with unique IDs and names (no duplicates, no gaps)
    expect(seenNames.size).toBe(151);
    expect(seenIds.size).toBe(151);
    for (let i = 1; i <= 151; i++) {
      const expectedName = `Paginate Workout ${String(i).padStart(3, '0')}`;
      expect(seenNames.has(expectedName)).toBe(true);
    }
  });
});
