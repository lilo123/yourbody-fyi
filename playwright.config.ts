import { defineConfig, devices } from '@playwright/test';
import fs from 'node:fs';

const useDevServer = Boolean(process.env.PW_DEV || process.env.VITE_DEV_SERVER);
const defaultPort = useDevServer ? '5173' : '4173';
const baseURL = process.env.BASE_URL || `http://localhost:${defaultPort}`;

let port = defaultPort;
try {
  const parsed = new URL(baseURL);
  if (parsed.port) {
    port = parsed.port;
  }
} catch {
  port = defaultPort;
}

const previewCommand =
  process.env.CI && fs.existsSync('./dist/index.html')
    ? `npx vite preview --port ${port} --strictPort`
    : `npm run build && npx vite preview --port ${port} --strictPort`;

const webServerCommand = useDevServer
  ? `npx vite --port ${port} --strictPort`
  : previewCommand;

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
    serviceWorkers: 'block',
    trace: process.env.CI ? 'retain-on-failure' : 'off',
    screenshot: 'only-on-failure',
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
    command: webServerCommand,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
});
