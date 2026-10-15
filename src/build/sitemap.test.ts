import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Sitemap & Robots Configuration', () => {
  const rootDir = path.resolve(__dirname, '../..');
  const sitemapPath = path.join(rootDir, 'public', 'sitemap.xml');
  const robotsPath = path.join(rootDir, 'public', 'robots.txt');
  const vercelPath = path.join(rootDir, 'vercel.json');
  const headersPath = path.join(rootDir, 'public', '_headers');

  it('includes public/sitemap.xml with canonical routes and valid XML structure', () => {
    expect(fs.existsSync(sitemapPath)).toBe(true);
    const sitemapContent = fs.readFileSync(sitemapPath, 'utf8');

    expect(sitemapContent).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(sitemapContent).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');

    const expectedUrls = [
      'https://www.yourbody.fyi/',
      'https://www.yourbody.fyi/terms',
      'https://www.yourbody.fyi/privacy',
      'https://www.yourbody.fyi/refunds',
    ];

    for (const url of expectedUrls) {
      expect(sitemapContent).toContain(`<loc>${url}</loc>`);
    }

    const locMatches = sitemapContent.match(/<loc>(.*?)<\/loc>/g) || [];
    expect(locMatches.length).toBe(expectedUrls.length);
  });

  it('appends Sitemap directive to public/robots.txt while preserving existing directives', () => {
    expect(fs.existsSync(robotsPath)).toBe(true);
    const robotsContent = fs.readFileSync(robotsPath, 'utf8');

    expect(robotsContent).toMatch(/User-agent:\s*\*/i);
    expect(robotsContent).toMatch(/Allow:\s*\//i);
    expect(robotsContent).toContain('Sitemap: https://www.yourbody.fyi/sitemap.xml');
  });

  it('excludes sitemap.xml from SPA rewrite fallback in vercel.json and specifies headers', () => {
    const vercelConfig = JSON.parse(fs.readFileSync(vercelPath, 'utf8'));

    const rewrite = vercelConfig.rewrites.find((r: { destination: string }) => r.destination === '/index.html');
    expect(rewrite).toBeDefined();
    expect(rewrite.source).toContain('sitemap\\.xml');
    expect(rewrite.source).toContain('robots\\.txt');

    const sitemapHeader = vercelConfig.headers.find((h: { source: string }) => h.source === '/sitemap.xml');
    expect(sitemapHeader).toBeDefined();
    const contentTypeHeader = sitemapHeader.headers.find((header: { key: string }) => header.key.toLowerCase() === 'content-type');
    expect(contentTypeHeader?.value).toBe('application/xml');
  });

  it('configures /sitemap.xml in public/_headers with matching Cache-Control and Content-Type', () => {
    const headersContent = fs.readFileSync(headersPath, 'utf8');
    expect(headersContent).toContain('/sitemap.xml');
    expect(headersContent).toMatch(/\/sitemap\.xml\s*\n\s*!\s*Cache-Control\s*\n\s*Cache-Control:\s*public,\s*max-age=86400,\s*stale-while-revalidate=604800\s*\n\s*Content-Type:\s*application\/xml/);
  });
});
