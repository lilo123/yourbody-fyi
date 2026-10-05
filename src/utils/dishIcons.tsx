import React from 'react';
import { Zap, Flame, Sparkles, Utensils } from 'lucide-react';

export function getDishIcon(name: string): React.ReactNode {
  const lower = name.toLowerCase();
  if (
    lower.includes('shake') ||
    lower.includes('smoothie') ||
    lower.includes('whey') ||
    lower.includes('protein') ||
    lower.includes('pre-workout') ||
    lower.includes('energy')
  ) {
    return <Zap className="w-4 h-4 text-cyan-400 shrink-0" />;
  }
  if (
    lower.includes('steak') ||
    lower.includes('beef') ||
    lower.includes('chicken') ||
    lower.includes('meat') ||
    lower.includes('burger') ||
    lower.includes('salmon') ||
    lower.includes('tuna') ||
    lower.includes('turkey') ||
    lower.includes('pork')
  ) {
    return <Flame className="w-4 h-4 text-amber-400 shrink-0" />;
  }
  if (
    lower.includes('oat') ||
    lower.includes('egg') ||
    lower.includes('toast') ||
    lower.includes('pancake') ||
    lower.includes('waffle') ||
    lower.includes('bowl') ||
    lower.includes('yogurt') ||
    lower.includes('fruit') ||
    lower.includes('apple') ||
    lower.includes('banana')
  ) {
    return <Sparkles className="w-4 h-4 text-emerald-400 shrink-0" />;
  }
  return <Utensils className="w-4 h-4 text-zinc-400 shrink-0" />;
}
