import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import type { LocalParseResult } from '../../lib/nutrition/localParse';

const EXAMPLE_NUTRITION_BLOCK = `Greek yogurt
Serving: 170 g
Calories: 130
Protein: 15g
Carbs: 6g
Fat: 5g`;

export const MealDemoSection: React.FC = () => {
  const [input, setInput] = useState(EXAMPLE_NUTRITION_BLOCK);
  const [result, setResult] = useState<LocalParseResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleRead = async () => {
    setIsLoading(true);
    try {
      const { parseNutritionBlock } = await import('../../lib/nutrition/localParse');
      const parsed = parseNutritionBlock(input);
      setResult(parsed);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <section
      id="meal-demo"
      data-testid="meal-demo-section"
      className="w-full border-t border-zinc-800/80 py-16 sm:py-20"
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-2xl mx-auto mb-8 sm:mb-12">
          <h2 className="text-2xl sm:text-4xl font-bold tracking-tight text-zinc-50">
            Try the meal parser
          </h2>
        </div>

        <div className="flex justify-center">
          <div className="w-full max-w-md bg-zinc-900/90 border border-zinc-800/80 rounded-3xl p-4 sm:p-6 shadow-2xl text-left backdrop-blur-xl space-y-4">
            <div>
              <textarea
                aria-label="Nutrition block input"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                rows={6}
                className="w-full min-h-[120px] rounded-xl bg-zinc-950/80 border border-zinc-800 p-3 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 resize-none font-normal leading-relaxed"
              />
            </div>

            <button
              type="button"
              onClick={handleRead}
              disabled={isLoading}
              aria-label="Read it"
              className="w-full min-h-[44px] px-4 py-2.5 rounded-xl text-xs font-bold transition touch-manipulation flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 bg-cyan-500 hover:bg-cyan-400 text-zinc-950 shadow-neon-cyan active:scale-98 cursor-pointer disabled:opacity-60"
            >
              Read it
            </button>

            {result && (
              <div data-testid="meal-demo-result" className="space-y-3 pt-2 border-t border-zinc-800/80">
                {result.ok ? (
                  <div className="bg-zinc-950/70 border border-zinc-800/60 rounded-xl p-3 space-y-2">
                    <div className="flex items-center justify-between text-xs font-bold text-zinc-100">
                      <span>{result.meal.name}</span>
                      {result.meal.servingSize && (
                        <span className="text-zinc-400 font-normal">
                          {result.meal.servingSize} {result.meal.servingUnit}
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-4 gap-2 text-center pt-1">
                      <div className="bg-zinc-900/60 rounded-lg py-1.5 px-1 border border-zinc-800/40">
                        <div className="text-xs text-zinc-400">Calories</div>
                        <div className="text-xs font-bold text-zinc-100 tabular-nums">
                          {result.meal.calories}
                        </div>
                      </div>
                      <div className="bg-zinc-900/60 rounded-lg py-1.5 px-1 border border-zinc-800/40">
                        <div className="text-xs text-zinc-400">Protein</div>
                        <div className="text-xs font-bold text-cyan-400 tabular-nums">
                          {result.meal.protein}g
                        </div>
                      </div>
                      <div className="bg-zinc-900/60 rounded-lg py-1.5 px-1 border border-zinc-800/40">
                        <div className="text-xs text-zinc-400">Carbs</div>
                        <div className="text-xs font-bold text-amber-400 tabular-nums">
                          {result.meal.carbs}g
                        </div>
                      </div>
                      <div className="bg-zinc-900/60 rounded-lg py-1.5 px-1 border border-zinc-800/40">
                        <div className="text-xs text-zinc-400">Fat</div>
                        <div className="text-xs font-bold text-rose-400 tabular-nums">
                          {result.meal.fat}g
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div
                    data-testid="meal-demo-failure"
                    className="rounded-xl bg-cyan-500/10 border border-cyan-500/20 p-3 text-xs text-cyan-300"
                  >
                    The full app can read this with AI parse after signing up.
                  </div>
                )}

                <Link
                  to="/login?mode=signup"
                  className="min-h-[44px] min-w-[44px] w-full px-6 py-2.5 inline-flex items-center justify-center rounded-xl text-xs font-bold bg-cyan-500 hover:bg-cyan-400 text-zinc-950 shadow-neon-cyan transition active:scale-95 touch-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500"
                >
                  Start free
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};
