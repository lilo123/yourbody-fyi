import { defineConfig } from '@playwright/test';

const defaultBaseUrl = 'http://localhost:5173';
const baseUrl = process.env.BASE_URL || defaultBaseUrl;
let port = '5173';
try {
  const parsed = new URL(baseUrl);
  if (parsed.port) {
    port = parsed.port;
  }
} catch {
  port = '5173';
}

export default defineConfig({
  testDir: './tests',
  testMatch: 'visual-density.test.ts',
  fullyParallel: false,
  reporter: 'list',
  use: {
    baseURL: baseUrl,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    trace: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 1,
      },
    },
  ],
  webServer: {
    command: `npx vite --port ${port} --strictPort`,
    url: baseUrl,
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
});
