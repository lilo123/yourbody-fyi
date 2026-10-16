import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import LandingView from '../components/landing/LandingView';
import { TermsPage } from '../legal/TermsPage';
import { PrivacyPage } from '../legal/PrivacyPage';
import { RefundsPage } from '../legal/RefundsPage';

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
];

export function renderRoute(path: string): string {
  let element: React.ReactElement;
  switch (path) {
    case '/':
      element = <LandingView />;
      break;
    case '/terms':
      element = <TermsPage />;
      break;
    case '/privacy':
      element = <PrivacyPage />;
      break;
    case '/refunds':
      element = <RefundsPage />;
      break;
    default:
      throw new Error(`Unknown prerender route: ${path}`);
  }

  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>{element}</MemoryRouter>
  );
}
