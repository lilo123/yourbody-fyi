import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('version.json PWA Navigation Fallback & Headers Configuration', () => {
  const rootDir = path.resolve(__dirname, '../..');
  const viteConfigPath = path.join(rootDir, 'vite.config.ts');
  const headersPath = path.join(rootDir, 'public', '_headers');

  it('excludes /version.json from service worker navigateFallbackDenylist in vite.config.ts', () => {
    expect(fs.existsSync(viteConfigPath)).toBe(true);
    const viteConfigContent = fs.readFileSync(viteConfigPath, 'utf8');

    expect(viteConfigContent).toContain('/^\\/version\\.json$/');
    expect(viteConfigContent).toMatch(
      /navigateFallbackDenylist:\s*\[[\s\S]*?\/\^\\\/robots\\\.txt\$\/,\s*\/\^\\\/sitemap\\\.xml\$\/,\s*\/\^\\\/version\\\.json\$\/[\s\S]*?\]/
    );

    const versionJsonRegex = /^\/version\.json$/;
    expect(versionJsonRegex.test('/version.json')).toBe(true);
    expect(versionJsonRegex.test('/version.json/')).toBe(false);
    expect(versionJsonRegex.test('/version.json/foo')).toBe(false);
    expect(versionJsonRegex.test('/api/version.json')).toBe(false);
  });

  it('preserves robots.txt and sitemap.xml in navigateFallbackDenylist', () => {
    const viteConfigContent = fs.readFileSync(viteConfigPath, 'utf8');
    expect(viteConfigContent).toContain('/^\\/robots\\.txt$/');
    expect(viteConfigContent).toContain('/^\\/sitemap\\.xml$/');
  });

  it('configures /version.json in public/_headers with no-cache directive', () => {
    expect(fs.existsSync(headersPath)).toBe(true);
    const headersContent = fs.readFileSync(headersPath, 'utf8');
    expect(headersContent).toContain('/version.json');
    expect(headersContent).toMatch(
      /\/version\.json\s*\n\s*!\s*Cache-Control\s*\n\s*Cache-Control:\s*no-cache/
    );
  });
});
