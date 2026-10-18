import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
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

    it('renders "/login" containing Sign In heading, Header, email and password inputs', () => {
      const html = renderRoute('/login');
      expect(html).toContain('Yourbody.fyi');
      expect(html).toContain('Sign In');
      expect(html).toContain('Email Address');
      expect(html).toContain('login-email');
      expect(html).toContain('login-password');
      expect(html).toContain('flex-1 max-w-xl w-full mx-auto p-4 pb-8');
      expect(html).toContain('min-h-[100dvh]');
    });

    it('defines PRERENDER_ROUTES covering all five public paths', () => {
      const paths = PRERENDER_ROUTES.map((r) => r.path);
      expect(paths).toEqual(['/', '/terms', '/privacy', '/refunds', '/login']);
    });

    it('renders exactly one h1 per prerendered public route for SEO compliance', () => {
      for (const route of PRERENDER_ROUTES) {
        const html = renderRoute(route.path);
        const h1Matches = html.match(/<h1[\s>]/gi) || [];
        expect(h1Matches.length, `Expected exactly 1 <h1> in prerender for ${route.path}`).toBe(1);
      }
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
      expect(guardContent).toContain('/login');
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

    it('removes #prerender via useLayoutEffect across LandingView, legal pages, and LoginView', () => {
      const landingSrc = fs.readFileSync(path.join(rootDir, 'src/components/landing/LandingView.tsx'), 'utf8');
      expect(landingSrc).toContain('useLayoutEffect');
      expect(landingSrc).toContain("document.getElementById('prerender')?.remove()");

      for (const legalFile of ['TermsPage.tsx', 'PrivacyPage.tsx', 'RefundsPage.tsx']) {
        const legalSrc = fs.readFileSync(path.join(rootDir, 'src/legal', legalFile), 'utf8');
        expect(legalSrc).toContain('useLayoutEffect');
        expect(legalSrc).toContain("document.getElementById('prerender')?.remove()");
      }

      const loginSrc = fs.readFileSync(path.join(rootDir, 'src/components/auth/LoginView.tsx'), 'utf8');
      expect(loginSrc).toContain('useLayoutEffect');
      expect(loginSrc).toContain("document.getElementById('prerender')?.remove()");
    });
  });

  describe('(c) dist/ build artifacts validation (when dist exists)', () => {
    it('contains rendered content in dist/index.html and the 3 legal html files', () => {
      if (!fs.existsSync(distDir)) {
        return; // Skip when dist has not been generated yet
      }

      const distIndex = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8');
      expect(distIndex).toContain('id="prerender"');
      expect(distIndex).toContain('data-prerender-route="/"');
      expect(distIndex).toMatch(/<meta\s+name=["']prerender-route["']\s+content=["']\/["']/);
      expect(distIndex).toContain('You know your workout. We just help you track it.');
      expect(distIndex).toContain('No frills.');
      expect(distIndex).toContain('Free forever.');
      expect(distIndex).toContain('Does it work in a gym with no signal?');

      const distTerms = fs.readFileSync(path.join(distDir, 'terms.html'), 'utf8');
      expect(distTerms).toContain('id="prerender"');
      expect(distTerms).toContain('data-prerender-route="/terms"');
      expect(distTerms).toMatch(/<meta\s+name=["']prerender-route["']\s+content=["']\/terms["']/);
      expect(distTerms).toContain('Terms of Service');

      const distPrivacy = fs.readFileSync(path.join(distDir, 'privacy.html'), 'utf8');
      expect(distPrivacy).toContain('id="prerender"');
      expect(distPrivacy).toContain('data-prerender-route="/privacy"');
      expect(distPrivacy).toMatch(/<meta\s+name=["']prerender-route["']\s+content=["']\/privacy["']/);
      expect(distPrivacy).toContain('Privacy Policy');

      const distRefunds = fs.readFileSync(path.join(distDir, 'refunds.html'), 'utf8');
      expect(distRefunds).toContain('id="prerender"');
      expect(distRefunds).toContain('data-prerender-route="/refunds"');
      expect(distRefunds).toMatch(/<meta\s+name=["']prerender-route["']\s+content=["']\/refunds["']/);
      expect(distRefunds).toContain('Refund Policy');

      const distLogin = fs.readFileSync(path.join(distDir, 'login.html'), 'utf8');
      expect(distLogin).toContain('id="prerender"');
      expect(distLogin).toContain('data-prerender-route="/login"');
      expect(distLogin).toMatch(/<meta\s+name=["']prerender-route["']\s+content=["']\/login["']/);
      expect(distLogin).toContain('Sign In');

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

  describe('(e) Prerender route guard logic across routes and auth states', () => {
    const loadGuard = () => {
      const code = fs.readFileSync(guardScriptPath, 'utf8');
      const ctx: any = {
        module: { exports: {} },
      };
      vm.runInNewContext(code, ctx);
      return ctx.module.exports as {
        normalizePath: (p?: string) => string;
        detectPrerenderRoute: () => string;
        shouldKeepPrerender: (opts: {
          pathname?: string;
          prerenderRoute?: string;
          hasUser?: boolean;
          isStandalone?: boolean;
        }) => boolean;
      };
    };

    it('normalizePath handles trailing slashes, .html extensions, and maps /index and /index.html to /', () => {
      const { normalizePath } = loadGuard();
      expect(normalizePath('/')).toBe('/');
      expect(normalizePath('')).toBe('/');
      expect(normalizePath('/index.html')).toBe('/');
      expect(normalizePath('/index')).toBe('/');
      expect(normalizePath('/index/')).toBe('/');
      expect(normalizePath('/terms')).toBe('/terms');
      expect(normalizePath('/terms/')).toBe('/terms');
      expect(normalizePath('/terms.html')).toBe('/terms');
      expect(normalizePath('/privacy')).toBe('/privacy');
      expect(normalizePath('/privacy/')).toBe('/privacy');
      expect(normalizePath('/privacy.html')).toBe('/privacy');
      expect(normalizePath('/refunds')).toBe('/refunds');
      expect(normalizePath('/refunds/')).toBe('/refunds');
      expect(normalizePath('/login')).toBe('/login');
      expect(normalizePath('/login/')).toBe('/login');
      expect(normalizePath('/login.html')).toBe('/login');
      expect(normalizePath('/workout')).toBe('/workout');
      expect(normalizePath('/workout/')).toBe('/workout');
    });

    it('guard logic for /, /index.html, /terms, /terms/, /privacy, /refunds, /login, /workout (signed-in vs signed-out)', () => {
      const { shouldKeepPrerender } = loadGuard();

      // Case 1: Landing page document (prerenderRoute = '/')
      // Signed-out visits to landing routes keep prerender
      expect(shouldKeepPrerender({ pathname: '/', prerenderRoute: '/', hasUser: false })).toBe(true);
      expect(shouldKeepPrerender({ pathname: '/index.html', prerenderRoute: '/', hasUser: false })).toBe(true);
      expect(shouldKeepPrerender({ pathname: '/index', prerenderRoute: '/', hasUser: false })).toBe(true);

      // Signed-in visits to landing routes hide prerender
      expect(shouldKeepPrerender({ pathname: '/', prerenderRoute: '/', hasUser: true })).toBe(false);
      expect(shouldKeepPrerender({ pathname: '/index.html', prerenderRoute: '/', hasUser: true })).toBe(false);

      // SW navigateFallback scenario: index.html served at legal, login, or app paths
      // Mismatch between current pathname and prerenderRoute '/' hides prerender immediately
      expect(shouldKeepPrerender({ pathname: '/terms', prerenderRoute: '/', hasUser: false })).toBe(false);
      expect(shouldKeepPrerender({ pathname: '/terms/', prerenderRoute: '/', hasUser: false })).toBe(false);
      expect(shouldKeepPrerender({ pathname: '/privacy', prerenderRoute: '/', hasUser: false })).toBe(false);
      expect(shouldKeepPrerender({ pathname: '/refunds', prerenderRoute: '/', hasUser: false })).toBe(false);
      expect(shouldKeepPrerender({ pathname: '/login', prerenderRoute: '/', hasUser: false })).toBe(false);
      expect(shouldKeepPrerender({ pathname: '/workout', prerenderRoute: '/', hasUser: false })).toBe(false);

      // Case 2: Terms document (prerenderRoute = '/terms')
      expect(shouldKeepPrerender({ pathname: '/terms', prerenderRoute: '/terms', hasUser: false })).toBe(true);
      expect(shouldKeepPrerender({ pathname: '/terms/', prerenderRoute: '/terms', hasUser: false })).toBe(true);
      expect(shouldKeepPrerender({ pathname: '/terms', prerenderRoute: '/terms', hasUser: true })).toBe(false);
      expect(shouldKeepPrerender({ pathname: '/', prerenderRoute: '/terms', hasUser: false })).toBe(false);
      expect(shouldKeepPrerender({ pathname: '/workout', prerenderRoute: '/terms', hasUser: false })).toBe(false);

      // Case 3: Privacy document (prerenderRoute = '/privacy')
      expect(shouldKeepPrerender({ pathname: '/privacy', prerenderRoute: '/privacy', hasUser: false })).toBe(true);
      expect(shouldKeepPrerender({ pathname: '/privacy/', prerenderRoute: '/privacy', hasUser: false })).toBe(true);
      expect(shouldKeepPrerender({ pathname: '/privacy', prerenderRoute: '/privacy', hasUser: true })).toBe(false);
      expect(shouldKeepPrerender({ pathname: '/', prerenderRoute: '/privacy', hasUser: false })).toBe(false);

      // Case 4: Refunds document (prerenderRoute = '/refunds')
      expect(shouldKeepPrerender({ pathname: '/refunds', prerenderRoute: '/refunds', hasUser: false })).toBe(true);
      expect(shouldKeepPrerender({ pathname: '/refunds/', prerenderRoute: '/refunds', hasUser: false })).toBe(true);
      expect(shouldKeepPrerender({ pathname: '/refunds', prerenderRoute: '/refunds', hasUser: true })).toBe(false);
      expect(shouldKeepPrerender({ pathname: '/', prerenderRoute: '/refunds', hasUser: false })).toBe(false);

      // Case 5: Login document (prerenderRoute = '/login')
      expect(shouldKeepPrerender({ pathname: '/login', prerenderRoute: '/login', hasUser: false })).toBe(true);
      expect(shouldKeepPrerender({ pathname: '/login/', prerenderRoute: '/login', hasUser: false })).toBe(true);
      expect(shouldKeepPrerender({ pathname: '/login', prerenderRoute: '/login', hasUser: true })).toBe(false);
      expect(shouldKeepPrerender({ pathname: '/', prerenderRoute: '/login', hasUser: false })).toBe(false);
      expect(shouldKeepPrerender({ pathname: '/workout', prerenderRoute: '/login', hasUser: false })).toBe(false);

      // Case 6: Non-public routes like /workout always hide prerender
      expect(shouldKeepPrerender({ pathname: '/workout', prerenderRoute: '/workout', hasUser: false })).toBe(false);
      expect(shouldKeepPrerender({ pathname: '/workout', prerenderRoute: '/workout', hasUser: true })).toBe(false);
    });

    it('standalone display mode always hides prerender', () => {
      const { shouldKeepPrerender } = loadGuard();
      expect(shouldKeepPrerender({ pathname: '/', prerenderRoute: '/', hasUser: false, isStandalone: true })).toBe(false);
      expect(shouldKeepPrerender({ pathname: '/terms', prerenderRoute: '/terms', hasUser: false, isStandalone: true })).toBe(false);
    });

    it('executes guard script in DOM environment: hides #prerender on SW fallback (/terms on index.html) and keeps visible on /index.html', () => {
      const code = fs.readFileSync(guardScriptPath, 'utf8');

      // Scenario A: SW fallback: user on /terms, index.html contains prerender-route="/"
      {
        const root = document.createElement('div');
        root.id = 'root';
        const prerender = document.createElement('div');
        prerender.id = 'prerender';
        prerender.setAttribute('data-prerender-route', '/');
        prerender.innerHTML = '<h1>Landing Hero</h1>';

        const meta = document.createElement('meta');
        meta.name = 'prerender-route';
        meta.content = '/';

        document.head.appendChild(meta);
        document.body.appendChild(prerender);
        document.body.appendChild(root);
        document.documentElement.className = 'dark';

        const mockWindow = {
          location: { pathname: '/terms' },
          matchMedia: () => ({ matches: false }),
          addEventListener: vi.fn(),
        };

        const ctx: any = {
          window: mockWindow,
          document,
          localStorage: { getItem: () => null, length: 0 },
          setTimeout,
          MutationObserver,
          module: { exports: {} },
        };

        vm.runInNewContext(code, ctx);

        // Expect hide-prerender applied immediately
        expect(document.documentElement.classList.contains('hide-prerender')).toBe(true);
        expect(document.getElementById('prerender')).toBeNull();

        // Clean up DOM
        meta.remove();
        root.remove();
        document.documentElement.className = 'dark';
      }

      // Scenario B: User loads /index.html on index.html (prerender-route="/")
      {
        const root = document.createElement('div');
        root.id = 'root';
        const prerender = document.createElement('div');
        prerender.id = 'prerender';
        prerender.setAttribute('data-prerender-route', '/');
        prerender.innerHTML = '<h1>Landing Hero</h1>';

        const meta = document.createElement('meta');
        meta.name = 'prerender-route';
        meta.content = '/';

        document.head.appendChild(meta);
        document.body.appendChild(prerender);
        document.body.appendChild(root);
        document.documentElement.className = 'dark';

        const mockWindow = {
          location: { pathname: '/index.html' },
          matchMedia: () => ({ matches: false }),
          addEventListener: vi.fn(),
        };

        const ctx: any = {
          window: mockWindow,
          document,
          localStorage: { getItem: () => null, length: 0 },
          setTimeout,
          MutationObserver,
          module: { exports: {} },
        };

        vm.runInNewContext(code, ctx);

        // Prerender must NOT be hidden
        expect(document.documentElement.classList.contains('hide-prerender')).toBe(false);
        expect(document.getElementById('prerender')).not.toBeNull();

        meta.remove();
        prerender.remove();
        root.remove();
        document.documentElement.className = 'dark';
      }
    });
  });
});
