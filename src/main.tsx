import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { setupQueryDefaults } from './offline'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import { initErrorReporting } from './lib/errorReporting.ts'

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

if (typeof document !== 'undefined') {
  const rawPath = (window.location && window.location.pathname) || '/';
  const normPath = rawPath.toLowerCase().replace(/\/+$/, '').replace(/\.html$/, '') || '/';
  const isPub = normPath === '/' || normPath === '/terms' || normPath === '/privacy' || normPath === '/refunds';
  const hasUser = (() => {
    try {
      if (localStorage.getItem('yourbody_user')) return true;
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('sb-') && k.endsWith('-auth-token')) return true;
      }
    } catch {
      return false;
    }
    return false;
  })();

  if (!isPub || hasUser || document.documentElement.classList.contains('hide-prerender')) {
    document.getElementById('prerender')?.remove();
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
