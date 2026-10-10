import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TermsPage } from './TermsPage';
import { PrivacyPage } from './PrivacyPage';
import { RefundsPage } from './RefundsPage';
import { App } from '../App';
import { expectNoA11yViolations } from '../test/a11y';

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
  },
}));

describe('Legal Pages', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  describe('Terms of Service (/terms)', () => {
    it('renders signed-out with main heading, health disclaimer, attribution link, and operator details', async () => {
      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/terms']}>
            <TermsPage />
          </MemoryRouter>
        </QueryClientProvider>
      );

      // Main heading (H1)
      const mainHeading = screen.getByRole('heading', { level: 1, name: 'Terms of Service' });
      expect(mainHeading).toBeDefined();

      // Health Disclaimer section and heading
      const healthDisclaimer = screen.getByRole('heading', { name: /Health Disclaimer/i });
      expect(healthDisclaimer).toBeDefined();
      expect(screen.getByText(/Yourbody is not medical advice/i)).toBeDefined();
      expect(screen.getByText(/Consult a qualified healthcare professional/i)).toBeDefined();
      expect(screen.getByText(/Not for medical emergencies/i)).toBeDefined();

      // AI-generated estimates disclaimer
      expect(screen.getByRole('heading', { name: /AI-Generated Estimates Disclaimer/i })).toBeDefined();
      expect(screen.getByText(/Google Gemini API/i)).toBeDefined();

      // Yearly Stripe billing and Basic / Pro plans
      expect(screen.getByText(/Paid subscriptions are billed on a yearly basis in advance via Stripe/i)).toBeDefined();
      expect(screen.getByText(/Basic and Pro plans/i)).toBeDefined();

      // Operator name and jurisdiction
      expect(screen.getAllByText(/Yourbody/i).length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText(/laws of the Province of Ontario/i)).toBeDefined();
      expect(screen.getByText(/courts of Ontario/i)).toBeDefined();

      // Contact address link
      const supportLink = screen.getByRole('link', { name: 'support@yourbody.fyi' });
      expect(supportLink).toBeDefined();
      expect(supportLink.getAttribute('href')).toBe('mailto:support@yourbody.fyi');

      // Last updated
      expect(screen.getByText('Last updated: 2026-10-10')).toBeDefined();

      // Attribution link to Basecamp policies and CC BY 4.0
      const ccLink = screen.getByRole('link', { name: 'CC BY 4.0' });
      expect(ccLink).toBeDefined();
      expect(ccLink.getAttribute('href')).toBe('https://creativecommons.org/licenses/by/4.0/');

      const basecampLink = screen.getByRole('link', { name: 'Basecamp open-source policies' });
      expect(basecampLink).toBeDefined();
      expect(basecampLink.getAttribute('href')).toBe('https://github.com/basecamp/policies');
    });

    it('passes axe accessibility audits', async () => {
      const { container } = render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/terms']}>
            <TermsPage />
          </MemoryRouter>
        </QueryClientProvider>
      );
      await expectNoA11yViolations(container);
    });
  });

  describe('Privacy Policy (/privacy)', () => {
    it('renders signed-out with main heading, collected data categories, subprocessors, and attribution', async () => {
      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/privacy']}>
            <PrivacyPage />
          </MemoryRouter>
        </QueryClientProvider>
      );

      // Main heading (H1)
      const mainHeading = screen.getByRole('heading', { level: 1, name: 'Privacy Policy' });
      expect(mainHeading).toBeDefined();

      // Data collected
      expect(screen.getByText(/Account Email:/i)).toBeDefined();
      expect(screen.getByText(/Workout & Nutrition Logs:/i)).toBeDefined();
      expect(screen.getByText(/Optional Meal Photos:/i)).toBeDefined();
      expect(screen.getByText(/Timezone:/i)).toBeDefined();
      expect(screen.getByText(/Device-Local Offline Storage:/i)).toBeDefined();
      expect(screen.getByText(/Error Reports with No User Identifiers:/i)).toBeDefined();

      // Legal bases
      expect(screen.getByText(/Contract:/i)).toBeDefined();
      expect(screen.getByText(/Consent:/i)).toBeDefined();
      expect(screen.getByText(/Legitimate Interest:/i)).toBeDefined();

      // PIPEDA Canadian privacy rights
      expect(screen.getByText(/Canadian Privacy Rights \(PIPEDA\)/i)).toBeDefined();
      expect(screen.getByText(/Personal Information Protection and Electronic Documents Act/i)).toBeDefined();
      expect(screen.getByText(/Office of the Privacy Commissioner of Canada/i)).toBeDefined();

      // Subprocessors table
      expect(screen.getByRole('heading', { name: /Subprocessors and Third-Party Services/i })).toBeDefined();
      expect(screen.getByText('Supabase')).toBeDefined();
      expect(screen.getByText('Google Gemini API')).toBeDefined();
      expect(screen.getByText('Stripe')).toBeDefined();
      expect(screen.getByText('Sentry')).toBeDefined();
      expect(screen.getByText('Cloudflare and Vercel')).toBeDefined();
      expect(screen.getByText('Resend')).toBeDefined();
      expect(screen.getByText('PostHog')).toBeDefined();

      // Cookies and Children
      expect(screen.getByText(/No advertising or tracking cookies/i)).toBeDefined();
      expect(screen.getByRole('heading', { name: /Children’s Privacy|Children's Privacy/i })).toBeDefined();

      // Contact and PIPEDA links
      const privacyLinks = screen.getAllByRole('link', { name: 'support@yourbody.fyi' });
      expect(privacyLinks.length).toBeGreaterThanOrEqual(2);
      expect(privacyLinks[0].getAttribute('href')).toBe('mailto:support@yourbody.fyi');

      // Attribution
      const ccLink = screen.getByRole('link', { name: 'CC BY 4.0' });
      expect(ccLink.getAttribute('href')).toBe('https://creativecommons.org/licenses/by/4.0/');
    });

    it('passes axe accessibility audits', async () => {
      const { container } = render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/privacy']}>
            <PrivacyPage />
          </MemoryRouter>
        </QueryClientProvider>
      );
      await expectNoA11yViolations(container);
    });
  });

  describe('Refund Policy (/refunds)', () => {
    it('renders signed-out with main heading, 30-day window, EU/UK notice, and attribution', async () => {
      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/refunds']}>
            <RefundsPage />
          </MemoryRouter>
        </QueryClientProvider>
      );

      // Main heading (H1)
      const mainHeading = screen.getByRole('heading', { level: 1, name: 'Refund Policy' });
      expect(mainHeading).toBeDefined();

      // Annual subscriptions and 30-day window
      expect(screen.getByRole('heading', { name: /Annual Subscriptions & Refund Window/i })).toBeDefined();
      expect(screen.getByText(/within 30 days/i)).toBeDefined();
      expect(screen.getByText(/Basic and Pro plans/i)).toBeDefined();

      // EU/UK notice
      expect(screen.getByRole('heading', { name: /European Union & UK Availability/i })).toBeDefined();
      expect(screen.getByText(/European Union \(EU\) or United Kingdom \(UK\) may currently be unavailable/i)).toBeDefined();

      // Contact links
      const refundSupportLinks = screen.getAllByRole('link', { name: 'support@yourbody.fyi' });
      expect(refundSupportLinks.length).toBeGreaterThanOrEqual(2);
      expect(refundSupportLinks[0].getAttribute('href')).toBe('mailto:support@yourbody.fyi');

      // Attribution
      const ccLink = screen.getByRole('link', { name: 'CC BY 4.0' });
      expect(ccLink.getAttribute('href')).toBe('https://creativecommons.org/licenses/by/4.0/');
    });

    it('passes axe accessibility audits', async () => {
      const { container } = render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/refunds']}>
            <RefundsPage />
          </MemoryRouter>
        </QueryClientProvider>
      );
      await expectNoA11yViolations(container);
    });
  });

  describe('App routing for legal pages', () => {
    it('allows signed-out users to directly reach /terms, /privacy, and /refunds without redirection to /login', async () => {
      window.history.pushState({}, '', '/terms');
      render(
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      );

      await waitFor(() => {
        expect(screen.getByRole('heading', { level: 1, name: 'Terms of Service' })).toBeDefined();
        expect(screen.getByRole('heading', { name: /Health Disclaimer/i })).toBeDefined();
      });
    });
  });
});
