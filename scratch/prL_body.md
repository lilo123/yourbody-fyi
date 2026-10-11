Review only: do not merge.

## Summary

Adds the public front door landing page for logged-out web visitors at `/` while strictly preserving existing installed PWA standalone routing, offline service worker caching, and performance budgets.

### Key Changes
- **Root routing decision (`src/App.tsx`, `src/utils/routeDecision.ts`):**
  - Web browser visitors without a cached session see the new `LandingView`.
  - Installed PWA users (`display-mode: standalone` / `navigator.standalone`) bypass marketing and continue to their last app route (`/workout` default) or auth redirect.
  - Users with active or cached profiles continue seamlessly to their application views.
  - While auth is initializing without a cached user, the existing authentication loading spinner displays without early redirection or flashing the landing page.
- **Lazy loaded chunk & bundle budget:**
  - `LandingView` is dynamically imported and lazy-loaded, avoiding impact to initial route critical paths.
  - Entry chunk size growth is +548 B (+0.56%), well under the ~700 B budget target.
  - Excluded from Workbox service worker precache (`dist/sw.js`) via `globIgnores: ['**/Landing*']`.
- **Public landing presentation (`src/components/landing/*`):**
  - Sections: Header, Hero with offline set row illustration, Features (Offline Gym Logger, AI Meal & Macro Logging, Coach Mode, Why a web app you can install), Pricing comparison table with monthly/yearly discounts, FAQ, and Footer.
  - Honest copy: highlights offline set/workout logging and on-device parsing while accurately clarifying that AI meal analysis requires internet connectivity.
  - 4 pricing tiers matching pricing specification: Free ($0), Personal ($2/mo or $10/yr), Coach ($5/mo or $40/yr), and Coach Pro ($10/mo or $80/yr). Paid tiers display "Coming soon" with disabled actions.
  - Lightweight inline SVG and CSS mock illustrations instead of heavy binary screenshots.
- **SEO & Search Crawler configuration:**
  - Added `public/robots.txt` (`User-agent: *`, `Allow: /`).
  - Added robots passthrough in `vercel.json` rewrites and `public/_headers` / `public/_redirects` to prevent SPA rewrite of `robots.txt`.
  - Added metadata, OpenGraph tags, canonical link, and Twitter card summary in `index.html`.
- **Automated Verification & E2E Testing:**
  - Vitest coverage for all root route decision matrix combinations and landing component interactions.
  - Playwright E2E spec verifying logged-out landing rendering, CTA sign-up navigation, standalone mode bypass, and footer links.

### Choices to confirm
1. **Headline & Subhead Copy:** Using "Track workouts and meals. Even without signal." and Option A clarifying online AI requirement.
2. **Audience Emphasis:** Personal lifters prioritized first (~70%), with Coach mode highlighted as an optional power capability.
3. **Illustrations vs Screenshots:** Lightweight CSS/SVG inline illustrations used to prevent asset bloat and avoid visual staleness across UI updates.
4. **Primary CTA destination:** "Start free" routes directly to `/login?mode=signup`.
5. **Support contact:** Public contact in footer configured to `support@yourbody.fyi`.
