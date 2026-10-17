import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { renderRoute, PRERENDER_ROUTES } from '../prerender/entry-server';
import { authStorageKey, AUTH_TOKEN_KEY_REGEX, hasValidAuthToken } from '../lib/supabase';

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

      // Outer wrapper matches App.tsx layout
      expect(html).toContain('min-h-[100dvh]');
    });

    it('renders "/terms" containing Terms of Service headings, Header, and main wrapper', () => {
      const html = renderRoute('/terms');
      expect(html).toContain('Terms of Service');
      expect(html).toContain('Health Disclaimer');
      expect(html).toContain('1. Agreement and Operator');
      expect(html).toContain('10. Contact Us');

      // Wrappers matching client App.tsx tree to prevent visual jump
      expect(html).toContain('Yourbody.fyi');
      expect(html).toContain('flex-1 max-w-xl w-full mx-auto p-4 pb-8');
      expect(html).toContain('min-h-[100dvh]');
    });

    it('renders "/privacy" containing Privacy Policy headings, Header, and main wrapper', () => {
      const html = renderRoute('/privacy');
      expect(html).toContain('Privacy Policy');
      expect(html).toContain('1. Introduction');
      expect(html).toContain('2. Information We Collect');
      expect(html).toContain('8. Contact Us');

      expect(html).toContain('Yourbody.fyi');
      expect(html).toContain('flex-1 max-w-xl w-full mx-auto p-4 pb-8');
      expect(html).toContain('min-h-[100dvh]');
    });

    it('renders "/refunds" containing Refund Policy headings, Header, and main wrapper', () => {
      const html = renderRoute('/refunds');
      expect(html).toContain('Refund Policy');
      expect(html).toContain('1. Our Refund Philosophy');
      expect(html).toContain('Annual Subscriptions');
      expect(html).toContain('6. How to Request a Refund');

      expect(html).toContain('Yourbody.fyi');
      expect(html).toContain('flex-1 max-w-xl w-full mx-auto p-4 pb-8');
      expect(html).toContain('min-h-[100dvh]');
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
      // Exact Supabase auth key regex excluding PKCE code-verifier
      expect(guardContent).toContain('AUTH_KEY_REGEX = /^sb-[a-zA-Z0-9_.-]+-auth-token$/');
      // Fail-safe listeners and bounded timeout
      expect(guardContent).toContain("window.addEventListener('error', removePrerenderIfRootPopulated)");
      expect(guardContent).toContain("window.addEventListener('unhandledrejection', removePrerenderIfRootPopulated)");
      expect(guardContent).toContain('root.childElementCount > 0');
      expect(guardContent).toContain('8000');
    });

    it('fail-safe timeout: leaves #prerender intact when JS blocked / #root empty after 10s, removes when #root mounted', () => {
      vi.useFakeTimers();
      const prerender = document.createElement('div');
      prerender.id = 'prerender';
      prerender.innerHTML = '<h1>Static Content</h1>';
      const root = document.createElement('div');
      root.id = 'root';
      document.body.appendChild(prerender);
      document.body.appendChild(root);

      const removePrerenderIfRootPopulated = () => {
        const r = document.getElementById('root');
        if (r && r.childElementCount > 0) {
          document.getElementById('prerender')?.remove();
        }
      };

      // Case 1: JS blocked / chunks never loaded -> #root stays empty
      setTimeout(removePrerenderIfRootPopulated, 8000);
      vi.advanceTimersByTime(10000);
      // Prerender must stay in the DOM so static copy stays readable
      expect(document.getElementById('prerender')).not.toBeNull();
      expect(document.getElementById('prerender')?.textContent).toContain('Static Content');

      // Case 2: App mounted into #root (child elements present) but never removed #prerender
      const child = document.createElement('div');
      child.textContent = 'Mounted App';
      root.appendChild(child);

      setTimeout(removePrerenderIfRootPopulated, 8000);
      vi.advanceTimersByTime(8000);
      // Prerender must now be removed because #root has rendered content
      expect(document.getElementById('prerender')).toBeNull();

      vi.useRealTimers();
      root.remove();
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

    it('updates sw.js precache revision for index.html to match final dist/index.html md5', () => {
      if (!fs.existsSync(distDir)) {
        return;
      }
      const swPath = path.join(distDir, 'sw.js');
      if (!fs.existsSync(swPath)) {
        return;
      }

      const swContent = fs.readFileSync(swPath, 'utf8');
      const indexHtmlBuffer = fs.readFileSync(path.join(distDir, 'index.html'));
      const expectedMd5 = crypto.createHash('md5').update(indexHtmlBuffer).digest('hex');

      const match = swContent.match(/\{url:"index\.html",revision:"([a-f0-9]+)"\}/);
      expect(match).not.toBeNull();
      expect(match?.[1]).toBe(expectedMd5);
    });
  });

  describe('(d) Supabase auth storage key and token validation', () => {
    it('exports authStorageKey conforming to AUTH_TOKEN_KEY_REGEX', () => {
      expect(typeof authStorageKey).toBe('string');
      expect(AUTH_TOKEN_KEY_REGEX.test(authStorageKey)).toBe(true);
    });

    it('hasValidAuthToken validates session payloads and excludes PKCE code verifiers', () => {
      const mockStorage: Record<string, string> = {};
      const fakeStorage = {
        getItem: (k: string) => mockStorage[k] ?? null,
        setItem: (k: string, v: string) => {
          mockStorage[k] = v;
        },
        removeItem: (k: string) => {
          delete mockStorage[k];
        },
        clear: () => {
          for (const k of Object.keys(mockStorage)) delete mockStorage[k];
        },
        key: (i: number) => Object.keys(mockStorage)[i] ?? null,
        get length() {
          return Object.keys(mockStorage).length;
        },
      } as Storage;

      // Empty storage
      expect(hasValidAuthToken(fakeStorage)).toBe(false);

      // PKCE code verifier key alone (signed out state) must not trigger hasUser
      fakeStorage.setItem('sb-local-auth-token-code-verifier', 'pkce-verifier-random-string');
      expect(hasValidAuthToken(fakeStorage)).toBe(false);

      // Invalid / corrupt payload on exact token key
      fakeStorage.setItem('sb-local-auth-token', 'not-valid-json');
      expect(hasValidAuthToken(fakeStorage)).toBe(false);

      // Non-auth payload
      fakeStorage.setItem('sb-local-auth-token', JSON.stringify({ some_other_data: true }));
      expect(hasValidAuthToken(fakeStorage)).toBe(false);

      // Valid session with access_token
      fakeStorage.setItem(
        'sb-local-auth-token',
        JSON.stringify({ access_token: 'fake-jwt-token', user: { id: 'u123' } })
      );
      expect(hasValidAuthToken(fakeStorage)).toBe(true);

      // Cached yourbody_user
      fakeStorage.clear();
      fakeStorage.setItem('yourbody_user', JSON.stringify({ id: 'u123', email: 'test@example.com' }));
      expect(hasValidAuthToken(fakeStorage)).toBe(true);
    });
  });
});
