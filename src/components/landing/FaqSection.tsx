import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';

interface FaqItem {
  question: string;
  answer: string;
}

const FAQ_ITEMS: readonly FaqItem[] = [
  {
    question: 'Does it work offline?',
    answer:
      'Yes for workout logging, set tracking, quick log, and on-device parsing. Sets and workouts save directly on your phone and sync when signal returns. AI photo and natural language meal analysis require an internet connection.',
  },
  {
    question: 'Does it work on iPhone & Android?',
    answer:
      'Yes. As a Progressive Web App (PWA), Yourbody works in any modern browser (Safari on iOS, Chrome on Android). You can add it directly to your home screen for a fast, full-screen app experience without downloading from an app store.',
  },
  {
    question: 'How does the AI trial work?',
    answer:
      'Every new account receives a 14-day trial with 30 AI meal logging requests per day when connected online. No credit card is required to sign up.',
  },
  {
    question: 'Can clients use it for free?',
    answer:
      "Yes. Athletes can track workouts and meals completely free. When connected to a trainer on a Coach or Coach Pro plan, athletes also receive shared AI meal logging quota from the coach's plan.",
  },
];

export const FaqSection: React.FC = () => {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const toggleItem = (index: number) => {
    setOpenIndex((current) => (current === index ? null : index));
  };

  return (
    <section id="faq" className="max-w-3xl mx-auto px-4 sm:px-6 py-16 sm:py-20 border-t border-zinc-800/80">
      <div className="text-center mb-10">
        <h2 className="text-2xl sm:text-4xl font-bold tracking-tight text-zinc-50">
          Frequently asked questions
        </h2>
        <p className="mt-4 text-xs sm:text-sm text-zinc-400">
          Plain answers about offline capabilities, platform support, and account options.
        </p>
      </div>

      <div className="space-y-3">
        {FAQ_ITEMS.map((item, index) => {
          const isOpen = openIndex === index;
          return (
            <div
              key={item.question}
              className="bg-zinc-900/60 border border-zinc-800/80 rounded-2xl overflow-hidden transition"
            >
              <button
                type="button"
                onClick={() => toggleItem(index)}
                aria-expanded={isOpen}
                className="w-full min-h-[44px] min-w-[44px] px-5 py-4 flex items-center justify-between text-left text-xs sm:text-sm font-bold text-zinc-100 hover:text-cyan-300 transition touch-manipulation"
              >
                <span>{item.question}</span>
                <ChevronDown
                  className={`w-4 h-4 text-zinc-400 shrink-0 ml-3 transition-transform duration-200 ${
                    isOpen ? 'rotate-180 text-cyan-400' : ''
                  }`}
                  aria-hidden="true"
                />
              </button>
              {isOpen && (
                <div className="px-5 pb-4 pt-1 text-xs text-zinc-300 leading-relaxed border-t border-zinc-800/40">
                  {item.answer}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
};
