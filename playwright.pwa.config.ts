import { defineConfig, devices } from '@playwright/test';

const port = process.env.PWA_PORT || '4325';
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: './tests/e2e-pwa',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL,
    serviceWorkers: 'allow',
    trace: 'off',
  },
  projects: [
    {
      name: 'Desktop Chrome',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `npm run build && npx vite preview --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
});
