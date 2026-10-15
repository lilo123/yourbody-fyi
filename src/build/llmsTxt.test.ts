import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('llms.txt PWA Navigation Fallback & Content Verification', () => {
  const rootDir = path.resolve(__dirname, '../..');
  const viteConfigPath = path.join(rootDir, 'vite.config.ts');
  const llmsTxtPath = path.join(rootDir, 'public', 'llms.txt');

  it('excludes /llms.txt from service worker navigateFallbackDenylist in vite.config.ts', () => {
    expect(fs.existsSync(viteConfigPath)).toBe(true);
    const viteConfigContent = fs.readFileSync(viteConfigPath, 'utf8');

    expect(viteConfigContent).toContain('/^\\/llms\\.txt$/');
    expect(viteConfigContent).toMatch(
      /navigateFallbackDenylist:\s*\[[\s\S]*?\/\^\\\/robots\\\.txt\$\/,\s*\/\^\\\/sitemap\\\.xml\$\/,\s*\/\^\\\/version\\\.json\$\/,\s*\/\^\\\/llms\\\.txt\$\/[\s\S]*?\]/
    );

    const llmsTxtRegex = /^\/llms\.txt$/;
    expect(llmsTxtRegex.test('/llms.txt')).toBe(true);
    expect(llmsTxtRegex.test('/llms.txt/')).toBe(false);
    expect(llmsTxtRegex.test('/llms.txt/foo')).toBe(false);
    expect(llmsTxtRegex.test('/api/llms.txt')).toBe(false);
  });

  it('preserves existing denylist patterns in vite.config.ts', () => {
    const viteConfigContent = fs.readFileSync(viteConfigPath, 'utf8');
    expect(viteConfigContent).toContain('/^\\/robots\\.txt$/');
    expect(viteConfigContent).toContain('/^\\/sitemap\\.xml$/');
    expect(viteConfigContent).toContain('/^\\/version\\.json$/');
  });

  it('verifies public/llms.txt structure, summary, links, and product neutrality', () => {
    expect(fs.existsSync(llmsTxtPath)).toBe(true);
    const content = fs.readFileSync(llmsTxtPath, 'utf8');

    expect(content.startsWith('# ')).toBe(true);
    expect(content).toMatch(/^> .+/m);

    const expectedLinks = [
      'https://www.yourbody.fyi/',
      '/terms',
      '/privacy',
      '/refunds',
      '/sitemap.xml',
    ];
    for (const link of expectedLinks) {
      expect(content).toContain(link);
    }

    const disallowedProductNames = [
      'chat' + 'gpt',
      'gpt' + '-4',
      'gpt' + '-3',
      'cl' + 'aude',
      'gem' + 'ini',
      'co' + 'pilot',
      'per' + 'plexity',
      'an' + 'thropic',
      'open' + 'ai',
    ];
    const lowerContent = content.toLowerCase();
    for (const name of disallowedProductNames) {
      expect(lowerContent).not.toContain(name);
    }
  });
});
