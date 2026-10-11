import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Check, Clock } from 'lucide-react';

interface DemoSet {
  id: number;
  setNumber: number;
  weight: number;
  reps: number;
  completed: boolean;
}

const INITIAL_SETS: DemoSet[] = [
  { id: 1, setNumber: 1, weight: 185, reps: 8, completed: true },
  { id: 2, setNumber: 2, weight: 205, reps: 6, completed: true },
];

function formatRestTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

export const HeroSection: React.FC = () => {
  const [sets, setSets] = useState<DemoSet[]>(INITIAL_SETS);
  const [weight, setWeight] = useState(225);
  const [reps, setReps] = useState(4);
  const [restSeconds, setRestSeconds] = useState<number | null>(null);
  const [timerId, setTimerId] = useState(0);
  const [lastSavedId, setLastSavedId] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState('');

  // Rest countdown interval (single interval, cleaned up on unmount or reset)
  useEffect(() => {
    if (timerId === 0) return;
    const interval = setInterval(() => {
      setRestSeconds((prev) => {
        if (prev === null || prev <= 1) {
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [timerId]);

  // Brief Saved badge state cleanup
  useEffect(() => {
    if (lastSavedId === null) return;
    const timeout = setTimeout(() => {
      setLastSavedId(null);
    }, 1500);
    return () => clearTimeout(timeout);
  }, [lastSavedId]);

  const handleLogSet = () => {
    if (sets.length >= 8) return;
    const nextSetNumber = sets.length + 1;
    const newId = Date.now() + Math.random();
    const newSet: DemoSet = {
      id: newId,
      setNumber: nextSetNumber,
      weight,
      reps,
      completed: true,
    };
    setSets((prev) => [...prev, newSet]);
    setLastSavedId(newId);
    setRestSeconds(90);
    setTimerId((prev) => prev + 1);
    setAnnouncement(`Set ${nextSetNumber} logged: ${weight} lbs x ${reps}`);
  };

  const handleToggleSet = (id: number) => {
    setSets((prev) =>
      prev.map((s) => (s.id === id ? { ...s, completed: !s.completed } : s))
    );
  };

  const handleReset = () => {
    setSets(INITIAL_SETS);
    setWeight(225);
    setReps(4);
    setRestSeconds(null);
    setTimerId(0);
    setLastSavedId(null);
    setAnnouncement('');
  };

  const completedCount = sets.filter((s) => s.completed).length;

  return (
    <section className="w-full">
      <div
        data-testid="landing-main-container"
        className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-12 sm:pt-20 pb-16 lg:pb-24"
      >
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center">
          {/* Left Column: Messaging & CTAs */}
          <div className="lg:col-span-7 text-center lg:text-left">
            <h1 className="text-3xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-zinc-50 leading-tight">
              You know your workout. We just help you track it.
            </h1>

            <p className="mt-5 text-sm sm:text-base lg:text-lg text-zinc-300 leading-relaxed max-w-2xl mx-auto lg:mx-0">
              A no-frills log for your lifts and meals. Free forever, with coach mode built in. Your data stays yours.
            </p>

            <div className="mt-8 flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-4">
              <Link
                to="/login?mode=signup"
                className="min-h-[44px] min-w-[44px] w-full sm:w-auto px-6 py-3.5 inline-flex items-center justify-center rounded-xl text-sm font-bold bg-cyan-500 hover:bg-cyan-400 text-zinc-950 shadow-neon-cyan transition active:scale-95 touch-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500"
              >
                Start free
              </Link>
              <Link
                to="/login"
                className="min-h-[44px] min-w-[44px] w-full sm:w-auto px-5 py-3.5 inline-flex items-center justify-center rounded-xl text-sm font-semibold text-zinc-300 hover:text-white bg-zinc-900/80 hover:bg-zinc-800/80 border border-zinc-800 transition touch-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500"
              >
                Sign in
              </Link>
            </div>

            <p className="mt-3 text-xs text-zinc-400">
              No credit card required. Free tier includes workout &amp; meal tracking.
            </p>
          </div>

          {/* Right Column: Interactive Demo Set-Row Card */}
          <div className="lg:col-span-5 flex justify-center lg:justify-end">
            <div className="w-full max-w-md bg-zinc-900/90 border border-zinc-800/80 rounded-3xl p-4 sm:p-6 shadow-2xl text-left backdrop-blur-xl">
              {/* Accessible Live Region */}
              <output className="sr-only" aria-live="polite">
                {announcement}
              </output>

              {/* Demo Header */}
              <div className="flex items-center justify-between border-b border-zinc-800/80 pb-3 mb-3">
                <div>
                  <div className="text-sm font-bold text-zinc-100">Bench Press &amp; Arms</div>
                  <div className="text-xs text-zinc-400">Today&apos;s workout</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-zinc-400 px-2.5 py-1 rounded-full bg-zinc-800/80 border border-zinc-700/60">
                    Try it
                  </span>
                  <button
                    type="button"
                    onClick={handleReset}
                    aria-label="Reset"
                    className="min-h-[44px] min-w-[44px] px-2 py-1 text-xs font-semibold text-zinc-400 hover:text-white transition touch-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 rounded-lg flex items-center justify-center cursor-pointer"
                  >
                    Reset
                  </button>
                </div>
              </div>

              {/* Exercise Section */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-zinc-200">
                  <span>Barbell Bench Press</span>
                  <span className="text-zinc-400">
                    {completedCount} {completedCount === 1 ? 'set' : 'sets'} completed
                  </span>
                </div>

                {/* Sets List (stable height with internal scroll) */}
                <div
                  data-testid="demo-sets-list"
                  className="bg-zinc-950/70 border border-zinc-800/60 rounded-xl p-2 space-y-1.5 max-h-[180px] overflow-y-auto"
                >
                  {sets.map((s) => {
                    const isJustSaved = s.id === lastSavedId;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => handleToggleSet(s.id)}
                        aria-label={`Toggle set ${s.setNumber}`}
                        className={`w-full min-h-[44px] px-3 py-2 flex items-center justify-between text-xs rounded-lg transition touch-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 cursor-pointer ${
                          isJustSaved
                            ? 'bg-cyan-500/10 border border-cyan-500/30 text-zinc-100 font-semibold'
                            : 'hover:bg-zinc-800/40 text-zinc-300'
                        }`}
                      >
                        <span className={`font-semibold ${isJustSaved ? 'text-cyan-400' : 'text-zinc-400'}`}>
                          Set {s.setNumber}
                        </span>
                        <span className={s.completed ? 'text-zinc-200' : 'text-zinc-400 line-through'}>
                          {s.weight} lbs × {s.reps} reps
                        </span>
                        {isJustSaved ? (
                          <span className="text-cyan-300 font-semibold">Saved</span>
                        ) : s.completed ? (
                          <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-300 flex items-center justify-center">
                            <Check className="w-3 h-3" />
                          </span>
                        ) : (
                          <span className="w-5 h-5 rounded-full border border-zinc-700 bg-zinc-900/50 flex items-center justify-center" aria-hidden="true" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Steppers & Log Set Controls */}
              <div className="mt-3 pt-3 border-t border-zinc-800/80 space-y-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {/* Weight Stepper */}
                  <div className="flex items-center justify-between bg-zinc-950/80 border border-zinc-800/80 rounded-xl px-1">
                    <button
                      type="button"
                      onClick={() => setWeight((w) => Math.max(0, w - 5))}
                      aria-label="Decrease weight"
                      className="min-h-[44px] min-w-[44px] flex items-center justify-center text-base font-bold text-zinc-300 hover:text-white hover:bg-zinc-800/60 rounded-lg transition touch-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 cursor-pointer"
                    >
                      −
                    </button>
                    <span className="text-xs font-semibold text-zinc-200 tabular-nums">
                      {weight} lbs
                    </span>
                    <button
                      type="button"
                      onClick={() => setWeight((w) => w + 5)}
                      aria-label="Increase weight"
                      className="min-h-[44px] min-w-[44px] flex items-center justify-center text-base font-bold text-zinc-300 hover:text-white hover:bg-zinc-800/60 rounded-lg transition touch-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 cursor-pointer"
                    >
                      +
                    </button>
                  </div>

                  {/* Reps Stepper */}
                  <div className="flex items-center justify-between bg-zinc-950/80 border border-zinc-800/80 rounded-xl px-1">
                    <button
                      type="button"
                      onClick={() => setReps((r) => Math.max(1, r - 1))}
                      aria-label="Decrease reps"
                      className="min-h-[44px] min-w-[44px] flex items-center justify-center text-base font-bold text-zinc-300 hover:text-white hover:bg-zinc-800/60 rounded-lg transition touch-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 cursor-pointer"
                    >
                      −
                    </button>
                    <span className="text-xs font-semibold text-zinc-200 tabular-nums">
                      {reps} reps
                    </span>
                    <button
                      type="button"
                      onClick={() => setReps((r) => r + 1)}
                      aria-label="Increase reps"
                      className="min-h-[44px] min-w-[44px] flex items-center justify-center text-base font-bold text-zinc-300 hover:text-white hover:bg-zinc-800/60 rounded-lg transition touch-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 cursor-pointer"
                    >
                      +
                    </button>
                  </div>
                </div>

                {/* Log Set Button */}
                <button
                  type="button"
                  onClick={handleLogSet}
                  disabled={sets.length >= 8}
                  aria-label="Log set"
                  className={`w-full min-h-[44px] px-4 py-2.5 rounded-xl text-xs font-bold transition touch-manipulation flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 ${
                    sets.length >= 8
                      ? 'bg-zinc-800 text-zinc-400 cursor-not-allowed opacity-60'
                      : 'bg-cyan-500 hover:bg-cyan-400 text-zinc-950 shadow-neon-cyan active:scale-98 cursor-pointer'
                  }`}
                >
                  Log set
                </button>
              </div>

              {/* Rest Timer Pill */}
              <div className="mt-3 flex items-center justify-between min-h-[36px] pt-3 border-t border-zinc-800/80">
                {restSeconds !== null ? (
                  <div
                    data-testid="demo-rest-timer"
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 text-xs font-bold tabular-nums"
                  >
                    <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Rest: {formatRestTime(restSeconds)}</span>
                  </div>
                ) : (
                  <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-zinc-800/40 border border-zinc-800 text-zinc-400 text-xs font-semibold">
                    <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Rest: 1:30</span>
                  </div>
                )}
                <span className="text-xs text-zinc-400">Auto rest timer</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
