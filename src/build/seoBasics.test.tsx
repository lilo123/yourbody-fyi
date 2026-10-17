import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { render } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { LandingView } from '../components/landing/LandingView';
import { FAQ_ITEMS } from '../components/landing/FaqSection';

describe('SEO Basics & Structured Data (SEO1A)', () => {
  const rootDir = path.resolve(__dirname, '../..');
  const indexHtmlPath = path.join(rootDir, 'index.html');
  const headersPath = path.join(rootDir, 'public', '_headers');
  const sitemapPath = path.join(rootDir, 'public', 'sitemap.xml');

  describe('(a) index.html canonical removal & valid JSON-LD', () => {
    it('does not contain any static canonical link tag', () => {
      const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');
      expect(indexHtml).not.toMatch(/<link\s+[^>]*rel=["']canonical["']/i);
    });

    it('contains valid JSON-LD blocks with required fields matching meta description', () => {
      const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');
      const metaDescriptionMatch = indexHtml.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i);
      expect(metaDescriptionMatch).toBeDefined();
      const metaDescription = metaDescriptionMatch ? metaDescriptionMatch[1] : '';
      expect(metaDescription.length).toBeGreaterThan(0);

      const scriptRegex = /<script\s+type=["']application\/ld\+json["']>([\s\S]*?)<\/script>/gi;
      const jsonLdBlocks: string[] = [];
      let match = scriptRegex.exec(indexHtml);
      while (match !== null) {
        jsonLdBlocks.push(match[1].trim());
        match = scriptRegex.exec(indexHtml);
      }

      expect(jsonLdBlocks.length).toBe(3);

      const parsedBlocks = jsonLdBlocks.map((blockContent) => {
        expect(() => JSON.parse(blockContent)).not.toThrow();
        return JSON.parse(blockContent);
      });

      const organizationBlock = parsedBlocks.find((item) => item['@type'] === 'Organization');
      expect(organizationBlock).toBeDefined();
      expect(organizationBlock['@context']).toBe('https://schema.org');
      expect(organizationBlock.name).toBe('Yourbody.fyi');
      expect(organizationBlock.url).toBe('https://www.yourbody.fyi/');
      expect(organizationBlock.logo).toBe('https://www.yourbody.fyi/pwa-512x512.png');

      const webSiteBlock = parsedBlocks.find((item) => item['@type'] === 'WebSite');
      expect(webSiteBlock).toBeDefined();
      expect(webSiteBlock['@context']).toBe('https://schema.org');
      expect(webSiteBlock.name).toBe('Yourbody.fyi');
      expect(webSiteBlock.url).toBe('https://www.yourbody.fyi/');

      const softwareAppBlock = parsedBlocks.find((item) => item['@type'] === 'SoftwareApplication');
      expect(softwareAppBlock).toBeDefined();
      expect(softwareAppBlock['@context']).toBe('https://schema.org');
      expect(softwareAppBlock.name).toBe('Yourbody.fyi');
      expect(softwareAppBlock.url).toBe('https://www.yourbody.fyi/');
      expect(softwareAppBlock.applicationCategory).toBe('HealthApplication');
      expect(softwareAppBlock.operatingSystem).toBe('Web');
      expect(softwareAppBlock.description).toBe(metaDescription);
    });
  });

  describe('(b) public/_headers canonical Links and X-Robots-Tag noindex', () => {
    interface HeaderRule {
      pathPattern: string;
      headers: Record<string, string>;
    }

    const parseHeaders = (content: string): HeaderRule[] => {
      const rules: HeaderRule[] = [];
      let currentRule: HeaderRule | null = null;
      for (const rawLine of content.split('\n')) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) {
          continue;
        }
        if (!rawLine.startsWith(' ') && !rawLine.startsWith('\t')) {
          currentRule = { pathPattern: line, headers: {} };
          rules.push(currentRule);
        } else if (currentRule && line.includes(':')) {
          const colonIndex = line.indexOf(':');
          const headerName = line.slice(0, colonIndex).trim().toLowerCase();
          const headerValue = line.slice(colonIndex + 1).trim();
          currentRule.headers[headerName] = headerValue;
        }
      }
      return rules;
    };

    it('sets per-path canonical Link headers for the 4 public routes', () => {
      const headersContent = fs.readFileSync(headersPath, 'utf8');
      const rules = parseHeaders(headersContent);

      const publicPaths = [
        { path: '/', expectedCanonical: 'https://www.yourbody.fyi/' },
        { path: '/terms', expectedCanonical: 'https://www.yourbody.fyi/terms' },
        { path: '/privacy', expectedCanonical: 'https://www.yourbody.fyi/privacy' },
        { path: '/refunds', expectedCanonical: 'https://www.yourbody.fyi/refunds' },
      ];

      for (const entry of publicPaths) {
        const matchingRule = rules.find((rule) => rule.pathPattern === entry.path);
        expect(matchingRule).toBeDefined();
        const linkHeader = matchingRule?.headers['link'];
        expect(linkHeader).toBe(`<${entry.expectedCanonical}>; rel="canonical"`);
      }
    });

    it('sets X-Robots-Tag: noindex for signed-in app routes and not for public routes', () => {
      const headersContent = fs.readFileSync(headersPath, 'utf8');
      const rules = parseHeaders(headersContent);

      const appRoutes = [
        '/workout',
        '/workout/*',
        '/nutrition',
        '/nutrition/*',
        '/history',
        '/history/*',
        '/exercises',
        '/exercises/*',
        '/coach',
        '/coach/*',
        '/settings',
        '/settings/*',
        '/login',
        '/login/*',
        '/reset-password',
        '/reset-password/*',
      ];

      for (const route of appRoutes) {
        const matchingRule = rules.find((rule) => rule.pathPattern === route);
        expect(matchingRule).toBeDefined();
        expect(matchingRule?.headers['x-robots-tag']).toBe('noindex');
      }

      const publicRoutes = ['/', '/terms', '/privacy', '/refunds'];
      for (const route of publicRoutes) {
        const matchingRule = rules.find((rule) => rule.pathPattern === route);
        if (matchingRule) {
          expect(matchingRule.headers['x-robots-tag']).toBeUndefined();
        }
      }
    });

    it('configures /og-image.png with stale-while-revalidate Cache-Control and no x-robots-tag', () => {
      const headersContent = fs.readFileSync(headersPath, 'utf8');
      const rules = parseHeaders(headersContent);

      const ogRule = rules.find((rule) => rule.pathPattern === '/og-image.png');
      expect(ogRule).toBeDefined();
      expect(ogRule?.headers['cache-control']).toBe(
        'public, max-age=86400, stale-while-revalidate=604800'
      );
      expect(ogRule?.headers['x-robots-tag']).toBeUndefined();
      expect(headersContent).toMatch(
        /\/og-image\.png\s*\n\s*!\s*Cache-Control\s*\n\s*Cache-Control:\s*public,\s*max-age=86400,\s*stale-while-revalidate=604800/
      );
    });

    it('does not conflict with existing /version.json or /sw.js rules', () => {
      const headersContent = fs.readFileSync(headersPath, 'utf8');
      const rules = parseHeaders(headersContent);

      const versionRule = rules.find((rule) => rule.pathPattern === '/version.json');
      expect(versionRule).toBeDefined();
      expect(versionRule?.headers['cache-control']).toBe('no-cache');
      expect(versionRule?.headers['x-robots-tag']).toBeUndefined();

      const swRule = rules.find((rule) => rule.pathPattern === '/sw.js');
      expect(swRule).toBeDefined();
      expect(swRule?.headers['cache-control']).toBe('no-cache');
      expect(swRule?.headers['x-robots-tag']).toBeUndefined();
    });
  });

  describe('(c) public/sitemap.xml lastmod dates', () => {
    it('includes <lastmod>2026-10-15</lastmod> for every canonical URL', () => {
      const sitemapContent = fs.readFileSync(sitemapPath, 'utf8');

      const expectedUrls = [
        'https://www.yourbody.fyi/',
        'https://www.yourbody.fyi/terms',
        'https://www.yourbody.fyi/privacy',
        'https://www.yourbody.fyi/refunds',
      ];

      for (const expectedUrl of expectedUrls) {
        const escapedUrl = expectedUrl.replace(/\//g, '\\/');
        const urlBlockPattern = new RegExp(`<url>\\s*<loc>${escapedUrl}<\\/loc>\\s*<lastmod>2026-10-15<\\/lastmod>\\s*<\\/url>`);
        expect(sitemapContent).toMatch(urlBlockPattern);
      }

      const locMatches = sitemapContent.match(/<loc>(.*?)<\/loc>/g) || [];
      const lastmodMatches = sitemapContent.match(/<lastmod>2026-10-15<\/lastmod>/g) || [];

      expect(locMatches.length).toBe(expectedUrls.length);
      expect(lastmodMatches.length).toBe(expectedUrls.length);
    });
  });

  describe('(d) Landing FAQPage JSON-LD runtime injection & cleanup', () => {
    it('injects one FAQPage block with questions matching FAQ data and removes on unmount', () => {
      const rendered = render(
        <BrowserRouter>
          <LandingView />
        </BrowserRouter>
      );

      const faqScript = document.head.querySelector('script[data-testid="faq-json-ld"]') as HTMLScriptElement | null;
      expect(faqScript).not.toBeNull();
      expect(faqScript?.type).toBe('application/ld+json');

      const parsedData = JSON.parse(faqScript?.textContent || '{}');
      expect(parsedData['@context']).toBe('https://schema.org');
      expect(parsedData['@type']).toBe('FAQPage');
      expect(parsedData.mainEntity).toBeInstanceOf(Array);
      expect(parsedData.mainEntity.length).toBe(FAQ_ITEMS.length);

      for (let i = 0; i < FAQ_ITEMS.length; i++) {
        expect(parsedData.mainEntity[i]['@type']).toBe('Question');
        expect(parsedData.mainEntity[i].name).toBe(FAQ_ITEMS[i].question);
        expect(parsedData.mainEntity[i].acceptedAnswer).toEqual({
          '@type': 'Answer',
          text: FAQ_ITEMS[i].answer,
        });
      }

      rendered.unmount();

      const scriptAfterUnmount = document.head.querySelector('script[data-testid="faq-json-ld"]');
      expect(scriptAfterUnmount).toBeNull();
    });
  });
});
