import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import LandingView from '../components/landing/LandingView';
import { TermsPage } from '../legal/TermsPage';
import { PrivacyPage } from '../legal/PrivacyPage';
import { RefundsPage } from '../legal/RefundsPage';
import { LoginView } from '../components/auth/LoginView';
import { Header } from '../components/common/Header';
import { AuthContext, type AuthContextType } from '../context/AuthContextTypes';

export interface PrerenderRoute {
  path: string;
  title: string;
  description: string;
  outFile: string;
}

export const PRERENDER_ROUTES: PrerenderRoute[] = [
  {
    path: '/',
    title: 'Yourbody.fyi | Fitness & Nutrition',
    description:
      'A no-frills workout and meal tracker. Free forever, with coach mode built in. Your data stays yours.',
    outFile: 'index.html',
  },
  {
    path: '/terms',
    title: 'Terms of Service | Yourbody.fyi',
    description:
      'These Terms of Service govern your use of the Yourbody fitness and nutrition tracking platform. Please read them carefully before using our services.',
    outFile: 'terms.html',
  },
  {
    path: '/privacy',
    title: 'Privacy Policy | Yourbody.fyi',
    description:
      'This Privacy Policy describes what personal data Yourbody collects, how it is used and stored, who it is shared with, and your choices regarding your information.',
    outFile: 'privacy.html',
  },
  {
    path: '/refunds',
    title: 'Refund Policy | Yourbody.fyi',
    description:
      'We believe refund policies should be fair, transparent, and respectful. If you are ever unhappy with Yourbody or experience an accidental charge, we want to help.',
    outFile: 'refunds.html',
  },
  {
    path: '/login',
    title: 'Sign In | Yourbody.fyi',
    description:
      'Sign in to Yourbody to track your workouts and meals. Free forever, with coach mode built in.',
    outFile: 'login.html',
  },
];

const noopAsync = async () => {};
const SIGNED_OUT_AUTH: AuthContextType = {
  user: null,
  profile: null,
  role: 'athlete',
  viewMode: 'athlete',
  isCoachMode: false,
  loading: false,
  signIn: async () => ({ success: false }),
  signUp: async () => ({ success: false }),
  signOut: noopAsync,
  updateProfile: async () => ({ success: false }),
  switchRole: noopAsync,
  refreshProfile: noopAsync,
  resendConfirmation: async () => ({ success: false }),
  requestPasswordReset: async () => ({ success: false }),
  resetPassword: async () => ({ success: false }),
};

export {
  generateSoftwareApplicationJsonLd,
  generateFreeOffer,
  getFreePricingTier,
  PRICING_TIERS,
} from '../components/landing/pricingData';

export function renderRoute(path: string): string {
  let element: React.ReactElement;
  switch (path) {
    case '/':
      element = (
        <div className="min-h-[100dvh] flex flex-col bg-zinc-950 text-zinc-100 selection:bg-cyan-500/20 selection:text-cyan-300">
          <LandingView />
        </div>
      );
      break;
    case '/terms':
    case '/privacy':
    case '/refunds': {
      let content: React.ReactElement;
      if (path === '/terms') {
        content = <TermsPage />;
      } else if (path === '/privacy') {
        content = <PrivacyPage />;
      } else {
        content = <RefundsPage />;
      }
      element = (
        <AuthContext.Provider value={SIGNED_OUT_AUTH}>
          <div className="min-h-[100dvh] flex flex-col bg-zinc-950 text-zinc-100 selection:bg-cyan-500/20 selection:text-cyan-300">
            <Header />
            <main className="flex-1 max-w-xl w-full mx-auto p-4 pb-8">
              {content}
            </main>
          </div>
        </AuthContext.Provider>
      );
      break;
    }
    case '/login': {
      element = (
        <AuthContext.Provider value={SIGNED_OUT_AUTH}>
          <div className="min-h-[100dvh] flex flex-col bg-zinc-950 text-zinc-100 selection:bg-cyan-500/20 selection:text-cyan-300">
            <Header />
            <main className="flex-1 max-w-xl w-full mx-auto p-4 pb-8">
              <LoginView />
            </main>
          </div>
        </AuthContext.Provider>
      );
      break;
    }
    default:
      throw new Error(`Unknown prerender route: ${path}`);
  }

  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>{element}</MemoryRouter>
  );
}
