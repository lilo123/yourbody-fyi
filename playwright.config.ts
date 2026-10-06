import { defineConfig, devices } from '@playwright/test';

const port = process.env.E2E_PORT || '5173';
const baseURL = `http://localhost:${port}`;
// Serve a production bundle by default. The unbundled dev server streams hundreds of
// module requests per navigation, and WebKit intermittently fails those loads
// ("Importing a module script failed") or the navigation itself. VITE_DISABLE_SW keeps
// the service worker out of this suite (the PWA suite covers it separately).
// Set E2E_SERVER_DEV=1 to run against the dev server instead.
const serverCommand = process.env.E2E_SERVER_DEV
  ? `npm run dev -- --port ${port} --strictPort`
  : `VITE_DISABLE_SW=true npx vite build && npx vite preview --port ${port} --strictPort`;

export default defineConfig({
  testDir: './tests/e2e',
  globalTeardown: './tests/e2e/global-teardown.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'Desktop Chrome',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'Mobile Safari',
      use: { ...devices['iPhone 14'] },
    },
    {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 7'] },
    },
    // The two narrowest devices still in use. Everything above renders at
    // >= 360 px, where the row overflow this feature fixes is invisible; these
    // are the only projects that can catch it coming back.
    {
      name: 'Narrow Chrome (320px)',
      use: { ...devices['Galaxy S9+'] },
    },
    {
      name: 'Narrow Safari (320px)',
      use: { ...devices['iPhone SE'] },
    },
    {
      name: 'perf-trace',
      testDir: './tests/perf',
      // The four route benchmarks must run ONE AT A TIME but must NOT
      // short-circuit each other. The global `fullyParallel: true` would run them
      // concurrently, and concurrent page loads contend for the local Supabase
      // connection pool and the CPU, which corrupts both the byte totals and the
      // vitals this project exists to measure. Pinning the project to sequential
      // execution lets the spec drop `mode: 'serial'` — under serial mode a single
      // failing route aborted the remaining three, which is how the /history breach
      // (158,904 B) stayed invisible through Tier 2 close-out.
      fullyParallel: false,
      use: {
        ...devices['Pixel 7'],
        trace: 'on',
      },
    },
  ],
  webServer: {
    command: serverCommand,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
});
