import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { renderRoute, PRERENDER_ROUTES } from '../prerender/entry-server';

describe('Prerender Output and Configuration', () => {
  const rootDir = path.resolve(__dirname, '../..');
  const distDir = path.join(rootDir, 'dist');
  const indexHtmlPath = path.join(rootDir, 'index.html');
  const guardScriptPath = path.join(rootDir, 'public', 'prerender-guard.js');
  const indexCssPath = path.join(rootDir, 'src', 'index.css');

  describe('(a) SSR renderRoute function outputs', () => {
    it('renders root "/" containing hero headline, feature titles, pricing tiers, and FAQ questions', () => {
      const html = renderRoute('/');

      // Hero headline
      expect(html).toContain('You know your workout. We just help you track it.');

      // Four pillar feature card titles
      expect(html).toContain('No frills.');
      expect(html).toContain('Free forever.');
      expect(html).toContain('Coach mode.');
      expect(html).toContain('Your body, your data.');

      // Pricing tier names
      expect(html).toContain('Free');
      expect(html).toContain('Personal');
      expect(html).toContain('Coach');
      expect(html).toContain('Coach Pro');

      // FAQ questions
      expect(html).toContain('Does it work in a gym with no signal?');
      expect(html).toContain('Is there an app?');
      expect(html).toContain('How does the AI trial work?');
      expect(html).toContain('Can my clients use it for free?');
    });

    it('renders "/terms" containing Terms of Service headings and key sections', () => {
      const html = renderRoute('/terms');
      expect(html).toContain('Terms of Service');
      expect(html).toContain('Health Disclaimer');
      expect(html).toContain('1. Agreement and Operator');
      expect(html).toContain('10. Contact Us');
    });

    it('renders "/privacy" containing Privacy Policy headings and key sections', () => {
      const html = renderRoute('/privacy');
      expect(html).toContain('Privacy Policy');
      expect(html).toContain('1. Introduction');
      expect(html).toContain('2. Information We Collect');
      expect(html).toContain('8. Contact Us');
    });

    it('renders "/refunds" containing Refund Policy headings and key sections', () => {
      const html = renderRoute('/refunds');
      expect(html).toContain('Refund Policy');
      expect(html).toContain('1. Our Refund Philosophy');
      expect(html).toContain('Annual Subscriptions');
      expect(html).toContain('6. How to Request a Refund');
    });

    it('defines PRERENDER_ROUTES covering all four public paths', () => {
      const paths = PRERENDER_ROUTES.map((r) => r.path);
      expect(paths).toEqual(['/', '/terms', '/privacy', '/refunds']);
    });
  });

  describe('(b) Source files guard tag, placeholder, and CSS rules', () => {
    it('includes external prerender-guard.js script tag in index.html head', () => {
      const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');
      expect(indexHtml).toMatch(/<script\s+src=["']\/prerender-guard\.js["']><\/script>/);
    });

    it('places #prerender container before #root in index.html', () => {
      const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');
      const prerenderIdx = indexHtml.indexOf('id="prerender"');
      const rootIdx = indexHtml.indexOf('id="root"');
      expect(prerenderIdx).toBeGreaterThan(-1);
      expect(rootIdx).toBeGreaterThan(-1);
      expect(prerenderIdx).toBeLessThan(rootIdx);
    });

    it('defines public/prerender-guard.js with checks for user, non-public path, and standalone', () => {
      expect(fs.existsSync(guardScriptPath)).toBe(true);
      const guardContent = fs.readFileSync(guardScriptPath, 'utf8');
      expect(guardContent).toContain('yourbody_user');
      expect(guardContent).toContain('hide-prerender');
      expect(guardContent).toContain('/terms');
      expect(guardContent).toContain('/privacy');
      expect(guardContent).toContain('/refunds');
      expect(guardContent).toContain('standalone');
    });

    it('defines html.hide-prerender #prerender rule in src/index.css', () => {
      const cssContent = fs.readFileSync(indexCssPath, 'utf8');
      expect(cssContent).toMatch(/html\.hide-prerender\s+#prerender\s*\{[^}]*display:\s*none\s*!important/);
    });

    it('defines out-of-flow #prerender ~ #root rule in src/index.css and index.html', () => {
      const cssContent = fs.readFileSync(indexCssPath, 'utf8');
      expect(cssContent).toContain('#prerender ~ #root');
      expect(cssContent).toContain('visibility: hidden');

      const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');
      expect(indexHtml).toContain('#prerender ~ #root');
      expect(indexHtml).toContain('visibility: hidden');
    });

    it('removes #prerender via useLayoutEffect across LandingView and legal pages', () => {
      const landingSrc = fs.readFileSync(path.join(rootDir, 'src/components/landing/LandingView.tsx'), 'utf8');
      expect(landingSrc).toContain('useLayoutEffect');
      expect(landingSrc).toContain("document.getElementById('prerender')?.remove()");

      for (const legalFile of ['TermsPage.tsx', 'PrivacyPage.tsx', 'RefundsPage.tsx']) {
        const legalSrc = fs.readFileSync(path.join(rootDir, 'src/legal', legalFile), 'utf8');
        expect(legalSrc).toContain('useLayoutEffect');
        expect(legalSrc).toContain("document.getElementById('prerender')?.remove()");
      }
    });
  });

  describe('(c) dist/ build artifacts validation (when dist exists)', () => {
    it('contains rendered content in dist/index.html and the 3 legal html files', () => {
      if (!fs.existsSync(distDir)) {
        return; // Skip when dist has not been generated yet
      }

      const distIndex = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8');
      expect(distIndex).toContain('id="prerender"');
      expect(distIndex).toContain('You know your workout. We just help you track it.');
      expect(distIndex).toContain('No frills.');
      expect(distIndex).toContain('Free forever.');
      expect(distIndex).toContain('Does it work in a gym with no signal?');

      const distTerms = fs.readFileSync(path.join(distDir, 'terms.html'), 'utf8');
      expect(distTerms).toContain('id="prerender"');
      expect(distTerms).toContain('Terms of Service');

      const distPrivacy = fs.readFileSync(path.join(distDir, 'privacy.html'), 'utf8');
      expect(distPrivacy).toContain('id="prerender"');
      expect(distPrivacy).toContain('Privacy Policy');

      const distRefunds = fs.readFileSync(path.join(distDir, 'refunds.html'), 'utf8');
      expect(distRefunds).toContain('id="prerender"');
      expect(distRefunds).toContain('Refund Policy');

      expect(fs.existsSync(path.join(distDir, 'prerender-guard.js'))).toBe(true);
    });
  });
});
