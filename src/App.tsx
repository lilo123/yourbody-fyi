import React, { useState, useEffect, useRef, Activity } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { useAuth } from './hooks/useAuth';
import { CoachProvider } from './context/CoachContext';
import { Header } from './components/common/Header';
import { BottomNav } from './components/common/BottomNav';
import { LoginView } from './components/auth/LoginView';
import { GlobalRestTimerPill } from './components/common/GlobalRestTimerPill';
import { ToastProvider } from './context/ToastContext';
import { ToastHost } from './components/common/ToastHost';
import { UpdateBanner } from './pwa/UpdateBanner';
import { recordLastRoute, getLastRoute } from './pwa/lastRoute';
import { SyncToastBridge } from './components/sync/SyncToastBridge';
import { AttentionBanner } from './components/sync/AttentionBanner';
import { useOfflinePrefetch } from './offline-prefetch';
import { registerOutboxUpdateBlocker, startAiQueueProcessor } from './offline';
import { registerUpdateBlocker } from './pwa/updateSafety';
import './App.css';

registerOutboxUpdateBlocker(registerUpdateBlocker);

const ResetPasswordView = React.lazy(() =>
  import('./components/auth/ResetPasswordView').then((m) => ({ default: m.ResetPasswordView }))
);

const WorkoutEngine = React.lazy(() =>
  import('./components/workout/WorkoutEngine').then((m) => ({ default: m.WorkoutEngine }))
);
const NutritionEngine = React.lazy(() =>
  import('./components/nutrition/NutritionEngine').then((m) => ({ default: m.NutritionEngine }))
);
const ExercisesView = React.lazy(() =>
  import('./components/exercises/ExercisesView').then((m) => ({ default: m.ExercisesView }))
);
const SettingsView = React.lazy(() =>
  import('./components/settings/SettingsView').then((m) => ({ default: m.SettingsView }))
);
const CoachCockpit = React.lazy(() =>
  import('./components/coach/CoachCockpit').then((m) => ({ default: m.CoachCockpit }))
);
const HistoryView = React.lazy(() =>
  import('./components/history/HistoryView').then((m) => ({ default: m.HistoryView }))
);
const TermsPage = React.lazy(() =>
  import('./legal/TermsPage').then((m) => ({ default: m.TermsPage }))
);
const PrivacyPage = React.lazy(() =>
  import('./legal/PrivacyPage').then((m) => ({ default: m.PrivacyPage }))
);
const RefundsPage = React.lazy(() =>
  import('./legal/RefundsPage').then((m) => ({ default: m.RefundsPage }))
);

const LazyFallback: React.FC = () => (
  <div className="min-h-[60vh] flex items-center justify-center p-12 text-cyan-400 text-xs">
    Loading...
  </div>
);

// Guard for authenticated routes
const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading, refreshProfile } = useAuth();
  const [showRetry, setShowRetry] = useState(false);

  /* oxlint-disable react/set-state-in-effect */
  useEffect(() => {
    if (!loading || user) {
      setShowRetry(false);
      return;
    }
    const timer = setTimeout(() => setShowRetry(true), 2000);
    return () => clearTimeout(timer);
  }, [loading, user]);

  // Display content immediately when optimistic cached user is available
  if (user) {
    return <>{children}</>;
  }

  if (loading) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center p-6 text-center space-y-4">
        <div className="w-8 h-8 rounded-full border-2 border-cyan-500/20 border-t-cyan-400 animate-spin" />
        <div className="text-cyan-400 text-xs tracking-wider">Connecting to Yourbody...</div>
        {showRetry && (
          <button
            type="button"
            onClick={() => {
              setShowRetry(false);
              refreshProfile();
            }}
            data-testid="auth-retry-button"
            className="px-4 py-2 min-h-[44px] rounded-xl text-xs font-bold bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 transition shadow-neon-cyan active:scale-95 touch-manipulation flex items-center justify-center"
          >
            Connecting to Yourbody... Tap to Retry
          </button>
        )}
      </div>
    );
  }
  return <Navigate to="/login" replace />;
};

// Guard for Coach-only routes
const CoachRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isCoachMode, loading } = useAuth();
  if (user) {
    if (!isCoachMode) {
      return <Navigate to="/workout" replace />;
    }
    return <>{children}</>;
  }
  if (loading) return null;
  return <Navigate to="/login" replace />;
};

// Guard for Login route when already authenticated
const PublicOnlyRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isCoachMode, loading } = useAuth();
  if (user) {
    return <Navigate to={isCoachMode ? '/coach' : '/workout'} replace />;
  }
  if (loading) return null;
  return <>{children}</>;
};

// Redirect '/' and '*' to user's last tab route (default /workout) per A12
const LastRouteRedirect: React.FC = () => {
  const { user, isCoachMode } = useAuth();
  let destination = getLastRoute(user?.id);
  if (destination === '/coach' && user && !isCoachMode) {
    destination = '/workout';
  }
  return <Navigate to={destination} replace />;
};

function AppLayout() {
  const { user } = useAuth();
  useOfflinePrefetch(user?.id);

  // Start/stop AI queue processor for signed-in user
  useEffect(() => {
    if (!user?.id) return;
    return startAiQueueProcessor({
      userId: user.id,
      analyze: async (item) => {
        const { parseNutrition } = await import('./components/nutrition/parseNutrition');
        return await parseNutrition({
          text: item.text,
          photo: item.photo
            ? {
                base64: item.photo.base64,
                dataUrl: `data:${item.photo.mime};base64,${item.photo.base64}`,
                mimeType: item.photo.mime,
                sizeBytes: 0,
                width: 0,
                height: 0,
              }
            : null,
        });
      },
    });
  }, [user?.id]);
  const location = useLocation();
  const onHistory = location.pathname === '/history';

  // Track last visited tab route per user (A12)
  useEffect(() => {
    if (user?.id) {
      recordLastRoute(location.pathname, user.id);
    }
  }, [location.pathname, user?.id]);

  // Track whether an authenticated user has visited /history
  const [visitedUserId, setVisitedUserId] = useState<string | null>(null);

  // Scroll preservation for /history
  const historyScrollYRef = useRef<number>(0);
  const wasOnHistoryRef = useRef(false);

  useEffect(() => {
    if (!user) {
      setVisitedUserId(null);
      historyScrollYRef.current = 0;
    } else if (onHistory) {
      setVisitedUserId(user.id);
    } else if (visitedUserId && visitedUserId !== user.id) {
      setVisitedUserId(null);
      historyScrollYRef.current = 0;
    }
  }, [user, onHistory, visitedUserId]);

  // Track scroll position while on /history (record only while onHistory)
  useEffect(() => {
    if (!onHistory) return;
    const handleScroll = () => {
      if (typeof window !== 'undefined' && window.location.pathname === '/history') {
        historyScrollYRef.current = window.scrollY;
      }
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, [onHistory]);

  // Restore scroll position after paint when returning to /history
  useEffect(() => {
    if (onHistory) {
      if (!wasOnHistoryRef.current) {
        wasOnHistoryRef.current = true;
        const targetY = historyScrollYRef.current;
        if (typeof requestAnimationFrame === 'function') {
          const frameId = requestAnimationFrame(() => {
            if (typeof window.scrollTo === 'function') {
              window.scrollTo(0, targetY);
            }
          });
          return () => cancelAnimationFrame(frameId);
        } else if (typeof window.scrollTo === 'function') {
          window.scrollTo(0, targetY);
        }
      }
    } else {
      wasOnHistoryRef.current = false;
    }
  }, [onHistory]);

  const shouldMountHistory = Boolean(user && (visitedUserId === user.id || onHistory));

  return (
    <div className="min-h-[100dvh] flex flex-col bg-zinc-950 text-zinc-100 selection:bg-cyan-500/20 selection:text-cyan-300">
      <Header />
      <UpdateBanner />
      <main className={`flex-1 max-w-xl w-full mx-auto p-4 ${user ? 'pb-[calc(9.5rem+env(safe-area-inset-bottom,0px))]' : 'pb-8'}`}>
        <React.Suspense fallback={<LazyFallback />}>
          <Routes>
            <Route path="/" element={<LastRouteRedirect />} />
            <Route
              path="/workout"
              element={
                <ProtectedRoute>
                  <AttentionBanner />
                  <WorkoutEngine />
                </ProtectedRoute>
              }
            />
            <Route
              path="/nutrition"
              element={
                <ProtectedRoute>
                  <NutritionEngine />
                </ProtectedRoute>
              }
            />
            <Route
              path="/history"
              element={
                <ProtectedRoute>
                  {null}
                </ProtectedRoute>
              }
            />
            <Route
              path="/exercises"
              element={
                <ProtectedRoute>
                  <ExercisesView />
                </ProtectedRoute>
              }
            />
            <Route
              path="/coach"
              element={
                <CoachRoute>
                  <CoachCockpit />
                </CoachRoute>
              }
            />
            <Route
              path="/settings"
              element={
                <ProtectedRoute>
                  <SettingsView />
                </ProtectedRoute>
              }
            />
            <Route
              path="/login"
              element={
                <PublicOnlyRoute>
                  <LoginView />
                </PublicOnlyRoute>
              }
            />
            <Route 
              path="/reset-password" 
              element={<ResetPasswordView />} 
            />
            <Route path="/terms" element={<TermsPage />} />
            <Route path="/privacy" element={<PrivacyPage />} />
            <Route path="/refunds" element={<RefundsPage />} />
            <Route path="*" element={<LastRouteRedirect />} />
          </Routes>
        </React.Suspense>
        {shouldMountHistory && (
          <Activity mode={onHistory ? 'visible' : 'hidden'}>
            <React.Suspense fallback={<LazyFallback />}>
              <HistoryView />
            </React.Suspense>
          </Activity>
        )}
      </main>
      <GlobalRestTimerPill />
      <BottomNav />
    </div>
  );
}

export function App() {
  return (
    <Router>
      <AuthProvider>
        <CoachProvider>
          <ToastProvider>
            <SyncToastBridge />
            <AppLayout />
            <ToastHost />
          </ToastProvider>
        </CoachProvider>
      </AuthProvider>
    </Router>
  );
}

export default App;
