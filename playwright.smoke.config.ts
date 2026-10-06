import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.SMOKE_BASE_URL;
if (!baseURL) {
  throw new Error('Missing required environment variable: SMOKE_BASE_URL');
}

export default defineConfig({
  testDir: './tests/smoke',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
