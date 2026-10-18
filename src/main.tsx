import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { setupQueryDefaults } from './offline'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import { initErrorReporting } from './lib/errorReporting.ts'
import { hasValidAuthToken } from './lib/supabase.ts'

initErrorReporting();

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000, // 1 minute default stale time
      gcTime: 10 * 60 * 1000, // 10 minutes cache garbage collection
      refetchOnWindowFocus: false,
      retry: (failureCount) => {
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          return false;
        }
        return failureCount < 1;
      },
      networkMode: 'offlineFirst',
    },
    mutations: {
      networkMode: 'always',
    },
  },
});

setupQueryDefaults(queryClient);

const removePrerender = () => {
  document.getElementById('prerender')?.remove();
};

const removePrerenderIfRootPopulated = () => {
  const root = document.getElementById('root');
  if (root && root.childElementCount > 0) {
    removePrerender();
  }
};

if (typeof window !== 'undefined') {
  window.addEventListener('error', removePrerenderIfRootPopulated);
  window.addEventListener('unhandledrejection', removePrerenderIfRootPopulated);
}

if (typeof document !== 'undefined') {
  const normalizeRoutePath = (raw?: string): string => {
    if (!raw) return '/';
    const clean = raw.toLowerCase().split('?')[0].split('#')[0].replace(/\/+$/, '') || '/';
    const noExt = clean.endsWith('.html') ? clean.slice(0, -5) || '/' : clean;
    return noExt === '/index' ? '/' : noExt;
  };

  const currentPath = normalizeRoutePath(window.location?.pathname);
  const metaRoute = document.querySelector('meta[name="prerender-route"]')?.getAttribute('content');
  const prerenderEl = document.getElementById('prerender');
  const renderedRoute = normalizeRoutePath(metaRoute || prerenderEl?.getAttribute('data-prerender-route') || '/');

  const isPub = currentPath === '/' || currentPath === '/terms' || currentPath === '/privacy' || currentPath === '/refunds' || currentPath === '/login';
  const isRouteMatch = currentPath === renderedRoute;
  const hasUser = hasValidAuthToken();

  if (!isPub || !isRouteMatch || hasUser || document.documentElement.classList.contains('hide-prerender')) {
    removePrerender();
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
)
