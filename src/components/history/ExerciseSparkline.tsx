import React from 'react';
import type { WeightUnit } from '../../utils/weight';
import { formatWeight } from '../../utils/weight';

export interface ExerciseSparklineProps {
  points: number[];
  width?: number;
  height?: number;
  strokeWidth?: number;
  className?: string;
  testId?: string;
  unit?: WeightUnit;
}

export const ExerciseSparkline: React.FC<ExerciseSparklineProps> = ({
  points,
  width = 100,
  height = 24,
  strokeWidth = 2,
  className = '',
  testId,
  unit,
}) => {
  if (!points || points.length < 2) {
    return null;
  }

  const first = points[0];
  const last = points[points.length - 1];
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min;

  const padX = strokeWidth * 2;
  const padY = strokeWidth * 2;
  const usableWidth = Math.max(1, width - padX * 2);
  const usableHeight = Math.max(1, height - padY * 2);

  const coords = points
    .map((val, idx) => {
      const x = padX + (idx / (points.length - 1)) * usableWidth;
      const y =
        range === 0
          ? padY + usableHeight / 2
          : padY + (1 - (val - min) / range) * usableHeight;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const firstDisplay = unit === 'kg' ? formatWeight(first, 'kg', { showUnit: true }) : formatWeight(first, 'lb');
  const lastDisplay = unit === 'kg' ? formatWeight(last, 'kg', { showUnit: true }) : formatWeight(last, 'lb');
  const ariaLabel = `Trend: first ${firstDisplay}, last ${lastDisplay} over ${points.length} sessions`;

  return (
    <svg
      {...({ role: 'img' })}
      aria-label={ariaLabel}
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      style={{ width, height }}
      className={`shrink-0 overflow-visible ${className}`}
      data-testid={testId}
      fill="none"
    >
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        points={coords}
      />
    </svg>
  );
};
