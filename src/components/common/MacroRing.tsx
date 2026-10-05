import React from 'react';
import { formatCalories, formatMacro } from '../../utils/nutrition';

export interface MacroRingProps {
  label: string;
  current: number;
  target: number;
  unit: string;
  colorClass: string;
  strokeColor: string;
  onClick?: () => void;
  testId?: string;
  subtitle?: string;
  isOver?: boolean;
  statusTestId?: string;
  statusAriaLabel?: string;
}

export const MacroRing: React.FC<MacroRingProps> = ({
  label,
  current,
  target,
  unit,
  colorClass,
  strokeColor,
  onClick,
  testId,
  subtitle,
  isOver,
  statusTestId,
  statusAriaLabel,
}) => {
  const safeTarget = target > 0 ? target : 1;
  const displayPercentage = Math.round((current / safeTarget) * 100);
  const strokePercentage = Math.min(Math.max(displayPercentage, 0), 100);

  const radius = 34;
  const strokeWidth = 3.5;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (strokePercentage / 100) * circumference;

  const isCalories = unit === 'kcal' || label.toLowerCase().includes('cal');
  const formattedCurrent = isCalories ? formatCalories(current) : formatMacro(current);
  const formattedTarget = isCalories ? formatCalories(target) : formatMacro(target);

  const innerContent = (
    <>
      <div className="relative w-16 h-16 sm:w-20 sm:h-20 flex items-center justify-center">
        <svg className="w-16 h-16 sm:w-20 sm:h-20 transform -rotate-90" viewBox="0 0 76 76">
          {/* Background circle */}
          <circle
            cx="38"
            cy="38"
            r={radius}
            stroke="currentColor"
            strokeWidth={strokeWidth}
            className="text-zinc-800"
            fill="transparent"
          />
          {/* Progress circle */}
          <circle
            cx="38"
            cy="38"
            r={radius}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            fill="transparent"
            className="transition-all duration-700 ease-out motion-reduce:transition-none"
          />
        </svg>
        <div className="absolute flex flex-col items-center justify-center text-center">
          <span className={`text-sm font-bold tabular-nums leading-none tracking-tight ${colorClass}`}>
            {formattedCurrent}
          </span>
          <span className="text-xs font-normal text-zinc-400 tabular-nums leading-none tracking-tight mt-0.5">
            /{formattedTarget}
          </span>
        </div>
      </div>
      <div className="mt-1 sm:mt-1.5 text-center w-full">
        <div className="text-xs font-bold uppercase tracking-wider text-zinc-300 truncate">
          {label}
        </div>
        {subtitle && (
          <div
            data-testid={statusTestId}
            aria-label={statusAriaLabel}
            className={`text-xs font-normal tracking-tight whitespace-nowrap ${
              isOver ? 'text-rose-400' : `${colorClass} opacity-70`
            }`}
          >
            <span>{subtitle}</span>
          </div>
        )}
        {!subtitle && (
          <div className="text-xs font-normal text-zinc-400 tabular-nums">
            {displayPercentage}%
          </div>
        )}
      </div>
    </>
  );

  const baseClasses =
    'flex flex-col items-center px-1.5 py-2 sm:p-2.5 bg-zinc-900/90 border border-zinc-800/80 rounded-2xl shadow-xl flex-1 w-full min-w-[56px] sm:min-w-[75px] min-h-[44px]';

  if (onClick) {
    return (
      <button
        type="button"
        onClick={(e) => {
          const target = e.target as HTMLElement | null;
          if (target && target.closest('[data-testid^="remaining-fuel-"]')) {
            return;
          }
          e.currentTarget.focus();
          onClick();
        }}
        data-testid={testId}
        aria-label={`${label} breakdown: ${formattedCurrent} of ${formattedTarget} ${unit}`}
        className={`${baseClasses} cursor-pointer hover:border-zinc-700 hover:bg-zinc-800/80 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 transition-all touch-manipulation`}
      >
        {innerContent}
      </button>
    );
  }

  return (
    <div data-testid={testId} className={baseClasses}>
      {innerContent}
    </div>
  );
};
