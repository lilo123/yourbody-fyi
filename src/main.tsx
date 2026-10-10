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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
)
