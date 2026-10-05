import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

interface RequestRecord {
  url: string;
  method: string;
  resourceType: string;
  status: number;
  bytes: number;
}

interface PerfVitals {
  fcp: number;
  lcp: number;
  cls: number;
  tbt: number;
  longTasksCount: number;
}

const perfResults: Record<string, any> = {};
let preflightPassed = false;

// Payload ceiling. Declared once so the four route assertions and the
// recorded artifact can never disagree about what the threshold is.
const CEILING_BYTES = 153600;
const SHARDS_DIR = path.resolve(process.cwd(), 'test-results', 'perf-shards');

/**
 * Records a route measurement, writes an individual shard to disk immediately,
 * and prints a one-line verdict.
 *
 * Writing per-test makes data collection immune to worker-process restarts
 * when assertions fail. The separate merge step (scripts/merge-perf-shards.js)
 * aggregates these shards into docs/perf-trace-results.json.
 */
function recordRoute(key: string, data: Record<string, unknown>) {
  const bytes = Number(data.supabaseTransferredBytes ?? 0);
  const over = bytes > CEILING_BYTES;
  const measuredAt = new Date().toISOString();
  const runId = process.env.PERF_RUN_ID ?? null;
  const record = {
    ...data,
    ceilingBytes: CEILING_BYTES,
    overCeiling: over,
    runId,
    measuredAt,
  };
  perfResults[key] = record;
  console.log(
    `[perf-route] ${key.padEnd(16)} ${String(bytes).padStart(9)} B  ceiling ${CEILING_BYTES}  ` +
      `${over ? `OVER by ${bytes - CEILING_BYTES} B` : 'within budget'}`
  );

  // Write individual shard immediately
  fs.mkdirSync(SHARDS_DIR, { recursive: true });
  const shardPath = path.join(SHARDS_DIR, `${key}.json`);
  fs.writeFileSync(shardPath, JSON.stringify(record, null, 2), 'utf8');
}

test.describe('Performance Trace & Route Baselines', () => {
  // R-3: deliberately NOT `mode: 'serial'`.
  //
  // Under serial mode the first failing route aborted every route after it, and
  // Playwright reported the remainder as "did not run". /workout payload is above ceiling, so
  // /nutrition, /history and /coach were never measured at all — which is exactly
  // how the /history breach survived Tier 2 close-out. Default mode runs each route
  // independently, so one breach can never mask another. Sequential execution (which
  // the measurements need) is guaranteed by `fullyParallel: false` on the perf-trace
  // project in playwright.config.ts, not by short-circuiting on failure.

  test.beforeAll(async () => {
    const supabaseUrl = process.env.VITE_SUPABASE_URL || 'http://127.0.0.1:58821';
    const supabaseAnonKey =
      process.env.VITE_SUPABASE_ANON_KEY ||
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
    const benchEmail = 'bench-athlete@yourbody.fyi';
    const benchPassword = 'password123';

    // 1. Authenticate as benchmark user
    const client = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false },
    });

    const { data: authData, error: authErr } = await client.auth.signInWithPassword({
      email: benchEmail,
      password: benchPassword,
    });

    if (authErr || !authData?.user) {
      throw new Error(
        `Pre-flight assertion failed: unable to authenticate benchmark user ${benchEmail}: ${authErr?.message || 'user not found'}`
      );
    }

    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const { data: workouts, error: wErr } = await client
      .from('workouts')
      .select('id, sets(id)')
      .eq('user_id', authData.user.id)
      .gte('date', ninetyDaysAgo)
      .limit(1000);

    if (wErr) {
      throw new Error(`Pre-flight assertion failed: querying workouts: ${wErr.message}`);
    }

    const workoutCount = workouts?.length ?? 0;
    const setCount = (workouts ?? []).reduce(
      (acc: number, w: any) => acc + (Array.isArray(w.sets) ? w.sets.length : 0),
      0
    );

    if (workoutCount < 50 || setCount < 550) {
      throw new Error(
        `Pre-flight assertion failed: benchmark account ${benchEmail} has fewer than required rows inside 90-day window: found ${workoutCount} workouts (expected >= 50) and ${setCount} sets (expected >= 550). Aborting perf trace run.`
      );
    }

    preflightPassed = true;
    console.log(
      `\n[perf-trace pre-flight] OK: verified benchmark account has ${workoutCount} workouts and ${setCount} sets in 90-day window.`
    );
  });

  test.afterAll(async () => {
    const manifestPath = path.resolve(process.cwd(), 'scripts', 'perf-payload-sources.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const requiredKeys: string[] = manifest.requiredRoutes;

    // Load any shards written by prior workers so the summary reflects all routes
    if (fs.existsSync(SHARDS_DIR)) {
      for (const file of fs.readdirSync(SHARDS_DIR)) {
        if (file.endsWith('.json')) {
          const k = file.replace(/\.json$/, '');
          if (!perfResults[k]) {
            try {
              perfResults[k] = JSON.parse(fs.readFileSync(path.join(SHARDS_DIR, file), 'utf8'));
            } catch {}
          }
        }
      }
    }

    // Always print a line per route, including ones that never produced a
    // measurement. A route that silently "did not run" is what hid the /history
    // breach, so absence is now reported as loudly as a breach.
    console.log('\n================ PER-ROUTE PAYLOAD SUMMARY ================');
    for (const k of requiredKeys) {
      const r = perfResults[k];
      if (!r) {
        console.log(`  ${k.padEnd(16)} NOT MEASURED  <-- route did not report`);
        continue;
      }
      const b = r.supabaseTransferredBytes ?? 0;
      console.log(
        `  ${k.padEnd(16)} ${String(b).padStart(9)} B  ${
          r.overCeiling ? `OVER by ${b - CEILING_BYTES} B` : 'within budget'
        }`
      );
    }
    console.log('===========================================================\n');
  });

  test('benchmark /workout first authenticated paint with seeded account', async ({ page }) => {
    // 1. Log in as benchmark athlete
    await page.goto('/login');
    await page.fill('input[type="email"]', 'bench-athlete@yourbody.fyi');
    await page.fill('input[type="password"]', 'password123');

    // Attach vitals observer before route transition to /workout
    await page.addInitScript(() => {
      (window as any).__perfMetrics = {
        fcp: 0,
        lcp: 0,
        cls: 0,
        tbt: 0,
        longTasksCount: 0,
      };

      try {
        new PerformanceObserver((entryList) => {
          for (const entry of entryList.getEntries()) {
            if (entry.name === 'first-contentful-paint') {
              (window as any).__perfMetrics.fcp = entry.startTime;
            }
          }
        }).observe({ type: 'paint', buffered: true });

        new PerformanceObserver((entryList) => {
          const entries = entryList.getEntries();
          if (entries.length > 0) {
            (window as any).__perfMetrics.lcp = entries[entries.length - 1].startTime;
          }
        }).observe({ type: 'largest-contentful-paint', buffered: true });

        new PerformanceObserver((entryList) => {
          for (const entry of entryList.getEntries()) {
            if (!(entry as any).hadRecentInput) {
              (window as any).__perfMetrics.cls += (entry as any).value;
            }
          }
        }).observe({ type: 'layout-shift', buffered: true });

        new PerformanceObserver((entryList) => {
          for (const entry of entryList.getEntries()) {
            if (entry.duration > 50) {
              (window as any).__perfMetrics.tbt += entry.duration - 50;
              (window as any).__perfMetrics.longTasksCount++;
            }
          }
        }).observe({ type: 'longtask', buffered: true });
      } catch {
        // Fallback for browsers without full PerformanceObserver support
      }
    });

    const requests: RequestRecord[] = [];
    let isWorkoutRoute = false;

    page.on('response', async (res) => {
      if (!isWorkoutRoute && !page.url().includes('/workout')) return;
      let size = 0;
      try {
        const buffer = await res.body();
        size = buffer.length;
      } catch {
        const cl = res.headers()['content-length'];
        if (cl) size = parseInt(cl, 10) || 0;
      }
      requests.push({
        url: res.url(),
        method: res.request().method(),
        resourceType: res.request().resourceType(),
        status: res.status(),
        bytes: size,
      });
    });

    const startMark = Date.now();
    await page.click('button[type="submit"]');
    await page.waitForURL('**/workout');
    await page.goto('/workout');
    isWorkoutRoute = true;

    // Wait for first paint of workout UI
    await expect(page.locator('[data-testid="routine-select-btn"]')).toBeVisible();
    await page.waitForLoadState('networkidle');
    const elapsed = Date.now() - startMark;

    // Small delay to ensure observers record paint
    await page.waitForTimeout(500);

    const vitals: PerfVitals = await page.evaluate(() => (window as any).__perfMetrics || {
      fcp: 0,
      lcp: 0,
      cls: 0,
      tbt: 0,
      longTasksCount: 0,
    });

    const totalBytes = requests.reduce((acc, r) => acc + r.bytes, 0);
    const supabaseRequests = requests.filter((r) => r.url.includes('/rest/v1/'));
    const supabaseBytes = supabaseRequests.reduce((acc, r) => acc + r.bytes, 0);

    const queryPayloads = supabaseRequests.map((r) => {
      const parsedUrl = new URL(r.url);
      return {
        path: parsedUrl.pathname.replace('/rest/v1/', ''),
        query: parsedUrl.search,
        status: r.status,
        bytes: r.bytes,
      };
    });

    recordRoute('workout_seeded', {
      route: '/workout',
      user: 'bench-athlete@yourbody.fyi (550 sets, 350 nutrition logs)',
      totalRequests: requests.length,
      totalTransferredBytes: totalBytes,
      supabaseQueryCount: supabaseRequests.length,
      supabaseTransferredBytes: supabaseBytes,
      queryBreakdown: queryPayloads,
      vitals,
      elapsedMs: elapsed,
    });

    console.log('\n--- /workout Baseline (Seeded Account) ---');
    console.log(`Total Requests: ${requests.length}`);
    console.log(`Total Transferred: ${(totalBytes / 1024).toFixed(2)} KB (${totalBytes} B)`);
    console.log(`Supabase Queries: ${supabaseRequests.length} (${(supabaseBytes / 1024).toFixed(2)} KB)`);
    for (const q of queryPayloads) {
      console.log(`  - ${q.path}: ${q.bytes} B`);
    }
    console.log(`Vitals: FCP=${vitals.fcp.toFixed(1)}ms, LCP=${vitals.lcp.toFixed(1)}ms, CLS=${vitals.cls.toFixed(4)}, TBT=${vitals.tbt.toFixed(1)}ms`);
    console.log('-------------------------------------------\n');

    expect(requests.length).toBeGreaterThan(0);
    expect(supabaseBytes).toBeLessThanOrEqual(CEILING_BYTES);
  });

  test('benchmark /nutrition route load', async ({ page }) => {
    // Log in as athlete
    await page.goto('/login');
    await page.fill('input[type="email"]', 'bench-athlete@yourbody.fyi');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/workout');

    // Add init script for nutrition navigation
    await page.addInitScript(() => {
      (window as any).__perfMetrics = { fcp: 0, lcp: 0, cls: 0, tbt: 0, longTasksCount: 0 };
      try {
        new PerformanceObserver((entryList) => {
          const entries = entryList.getEntries();
          if (entries.length > 0) (window as any).__perfMetrics.lcp = entries[entries.length - 1].startTime;
        }).observe({ type: 'largest-contentful-paint', buffered: true });
        new PerformanceObserver((entryList) => {
          for (const entry of entryList.getEntries()) {
            if (!(entry as any).hadRecentInput) (window as any).__perfMetrics.cls += (entry as any).value;
          }
        }).observe({ type: 'layout-shift', buffered: true });
        new PerformanceObserver((entryList) => {
          for (const entry of entryList.getEntries()) {
            if (entry.duration > 50) {
              (window as any).__perfMetrics.tbt += entry.duration - 50;
              (window as any).__perfMetrics.longTasksCount++;
            }
          }
        }).observe({ type: 'longtask', buffered: true });
      } catch {}
    });

    const requests: RequestRecord[] = [];
    page.on('response', async (res) => {
      let size = 0;
      try {
        const buffer = await res.body();
        size = buffer.length;
      } catch {
        const cl = res.headers()['content-length'];
        if (cl) size = parseInt(cl, 10) || 0;
      }
      requests.push({
        url: res.url(),
        method: res.request().method(),
        resourceType: res.request().resourceType(),
        status: res.status(),
        bytes: size,
      });
    });

    await page.goto('/nutrition');
    await page.waitForSelector('[data-testid="meal-timeline"], [data-testid="macro-ring-calories"], form');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    const vitals: PerfVitals = await page.evaluate(() => (window as any).__perfMetrics || { fcp: 0, lcp: 0, cls: 0, tbt: 0, longTasksCount: 0 });
    const totalBytes = requests.reduce((acc, r) => acc + r.bytes, 0);
    const supabaseRequests = requests.filter((r) => r.url.includes('/rest/v1/'));
    const supabaseBytes = supabaseRequests.reduce((acc, r) => acc + r.bytes, 0);

    const queryPayloads = supabaseRequests.map((r) => {
      const parsedUrl = new URL(r.url);
      return {
        path: parsedUrl.pathname.replace('/rest/v1/', ''),
        query: parsedUrl.search,
        status: r.status,
        bytes: r.bytes,
      };
    });

    recordRoute('nutrition', {
      route: '/nutrition',
      totalRequests: requests.length,
      totalTransferredBytes: totalBytes,
      supabaseQueryCount: supabaseRequests.length,
      supabaseTransferredBytes: supabaseBytes,
      queryBreakdown: queryPayloads,
      vitals,
    });

    console.log('\n--- /nutrition Baseline ---');
    console.log(`Total Requests: ${requests.length}`);
    console.log(`Total Transferred: ${(totalBytes / 1024).toFixed(2)} KB`);
    console.log(`Supabase Queries: ${supabaseRequests.length} (${(supabaseBytes / 1024).toFixed(2)} KB)`);
    for (const q of queryPayloads) {
      console.log(`  - ${q.path}: ${q.bytes} B`);
    }
    console.log(`Vitals: LCP=${vitals.lcp.toFixed(1)}ms, CLS=${vitals.cls.toFixed(4)}, TBT=${vitals.tbt.toFixed(1)}ms`);
    console.log('---------------------------\n');

    expect(requests.length).toBeGreaterThan(0);
    expect(supabaseBytes).toBeLessThanOrEqual(CEILING_BYTES);
  });

  test('benchmark /history route load', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', 'bench-athlete@yourbody.fyi');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/workout');

    await page.addInitScript(() => {
      (window as any).__perfMetrics = { fcp: 0, lcp: 0, cls: 0, tbt: 0, longTasksCount: 0 };
      try {
        new PerformanceObserver((entryList) => {
          const entries = entryList.getEntries();
          if (entries.length > 0) (window as any).__perfMetrics.lcp = entries[entries.length - 1].startTime;
        }).observe({ type: 'largest-contentful-paint', buffered: true });
        new PerformanceObserver((entryList) => {
          for (const entry of entryList.getEntries()) {
            if (!(entry as any).hadRecentInput) (window as any).__perfMetrics.cls += (entry as any).value;
          }
        }).observe({ type: 'layout-shift', buffered: true });
        new PerformanceObserver((entryList) => {
          for (const entry of entryList.getEntries()) {
            if (entry.duration > 50) {
              (window as any).__perfMetrics.tbt += entry.duration - 50;
              (window as any).__perfMetrics.longTasksCount++;
            }
          }
        }).observe({ type: 'longtask', buffered: true });
      } catch {}
    });

    const requests: RequestRecord[] = [];
    page.on('response', async (res) => {
      let size = 0;
      try {
        const buffer = await res.body();
        size = buffer.length;
      } catch {
        const cl = res.headers()['content-length'];
        if (cl) size = parseInt(cl, 10) || 0;
      }
      requests.push({
        url: res.url(),
        method: res.request().method(),
        resourceType: res.request().resourceType(),
        status: res.status(),
        bytes: size,
      });
    });

    await page.goto('/history');
    await expect(page.locator('text=Workout History')).toBeVisible();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    const vitals: PerfVitals = await page.evaluate(() => (window as any).__perfMetrics || { fcp: 0, lcp: 0, cls: 0, tbt: 0, longTasksCount: 0 });
    const totalBytes = requests.reduce((acc, r) => acc + r.bytes, 0);
    const supabaseRequests = requests.filter((r) => r.url.includes('/rest/v1/'));
    const supabaseBytes = supabaseRequests.reduce((acc, r) => acc + r.bytes, 0);

    const queryPayloads = supabaseRequests.map((r) => {
      const parsedUrl = new URL(r.url);
      return {
        path: parsedUrl.pathname.replace('/rest/v1/', ''),
        query: parsedUrl.search,
        status: r.status,
        bytes: r.bytes,
      };
    });

    recordRoute('history', {
      route: '/history',
      totalRequests: requests.length,
      totalTransferredBytes: totalBytes,
      supabaseQueryCount: supabaseRequests.length,
      supabaseTransferredBytes: supabaseBytes,
      queryBreakdown: queryPayloads,
      vitals,
    });

    console.log('\n--- /history Baseline ---');
    console.log(`Total Requests: ${requests.length}`);
    console.log(`Total Transferred: ${(totalBytes / 1024).toFixed(2)} KB`);
    console.log(`Supabase Queries: ${supabaseRequests.length} (${(supabaseBytes / 1024).toFixed(2)} KB)`);
    for (const q of queryPayloads) {
      console.log(`  - ${q.path}: ${q.bytes} B`);
    }
    console.log(`Vitals: LCP=${vitals.lcp.toFixed(1)}ms, CLS=${vitals.cls.toFixed(4)}, TBT=${vitals.tbt.toFixed(1)}ms`);
    console.log('-------------------------\n');

    expect(requests.length).toBeGreaterThan(0);
    expect(supabaseBytes).toBeLessThanOrEqual(CEILING_BYTES);
  });

  test('benchmark /coach route load', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', 'coach@yourbody.fyi');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/coach');

    await page.addInitScript(() => {
      (window as any).__perfMetrics = { fcp: 0, lcp: 0, cls: 0, tbt: 0, longTasksCount: 0 };
      try {
        new PerformanceObserver((entryList) => {
          const entries = entryList.getEntries();
          if (entries.length > 0) (window as any).__perfMetrics.lcp = entries[entries.length - 1].startTime;
        }).observe({ type: 'largest-contentful-paint', buffered: true });
        new PerformanceObserver((entryList) => {
          for (const entry of entryList.getEntries()) {
            if (!(entry as any).hadRecentInput) (window as any).__perfMetrics.cls += (entry as any).value;
          }
        }).observe({ type: 'layout-shift', buffered: true });
        new PerformanceObserver((entryList) => {
          for (const entry of entryList.getEntries()) {
            if (entry.duration > 50) {
              (window as any).__perfMetrics.tbt += entry.duration - 50;
              (window as any).__perfMetrics.longTasksCount++;
            }
          }
        }).observe({ type: 'longtask', buffered: true });
      } catch {}
    });

    const requests: RequestRecord[] = [];
    page.on('response', async (res) => {
      let size = 0;
      try {
        const buffer = await res.body();
        size = buffer.length;
      } catch {
        const cl = res.headers()['content-length'];
        if (cl) size = parseInt(cl, 10) || 0;
      }
      requests.push({
        url: res.url(),
        method: res.request().method(),
        resourceType: res.request().resourceType(),
        status: res.status(),
        bytes: size,
      });
    });

    await page.goto('/coach');
    await expect(page.locator('text=Coach Dashboard')).toBeVisible();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    const vitals: PerfVitals = await page.evaluate(() => (window as any).__perfMetrics || { fcp: 0, lcp: 0, cls: 0, tbt: 0, longTasksCount: 0 });
    const totalBytes = requests.reduce((acc, r) => acc + r.bytes, 0);
    const supabaseRequests = requests.filter((r) => r.url.includes('/rest/v1/'));
    const supabaseBytes = supabaseRequests.reduce((acc, r) => acc + r.bytes, 0);

    const queryPayloads = supabaseRequests.map((r) => {
      const parsedUrl = new URL(r.url);
      return {
        path: parsedUrl.pathname.replace('/rest/v1/', ''),
        query: parsedUrl.search,
        status: r.status,
        bytes: r.bytes,
      };
    });

    recordRoute('coach', {
      route: '/coach',
      totalRequests: requests.length,
      totalTransferredBytes: totalBytes,
      supabaseQueryCount: supabaseRequests.length,
      supabaseTransferredBytes: supabaseBytes,
      queryBreakdown: queryPayloads,
      vitals,
    });

    console.log('\n--- /coach Baseline ---');
    console.log(`Total Requests: ${requests.length}`);
    console.log(`Total Transferred: ${(totalBytes / 1024).toFixed(2)} KB`);
    console.log(`Supabase Queries: ${supabaseRequests.length} (${(supabaseBytes / 1024).toFixed(2)} KB)`);
    for (const q of queryPayloads) {
      console.log(`  - ${q.path}: ${q.bytes} B`);
    }
    console.log(`Vitals: LCP=${vitals.lcp.toFixed(1)}ms, CLS=${vitals.cls.toFixed(4)}, TBT=${vitals.tbt.toFixed(1)}ms`);
    console.log('-----------------------\n');

    expect(requests.length).toBeGreaterThan(0);
    expect(supabaseBytes).toBeLessThanOrEqual(CEILING_BYTES);
  });
});
