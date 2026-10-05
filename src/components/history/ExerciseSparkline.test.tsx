import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ExerciseSparkline } from './ExerciseSparkline';

describe('ExerciseSparkline', () => {
  it('renders nothing when points array has fewer than 2 points', () => {
    const { container: emptyContainer } = render(<ExerciseSparkline points={[]} />);
    expect(emptyContainer.firstChild).toBeNull();

    const { container: singleContainer } = render(<ExerciseSparkline points={[135]} />);
    expect(singleContainer.firstChild).toBeNull();
  });

  it('renders inline SVG polyline with role=img and aria-label for 2 points', () => {
    render(<ExerciseSparkline points={[135, 185]} testId="sparkline-test" />);

    const svg = screen.getByRole('img');
    expect(svg).toBeDefined();
    expect(svg).toHaveAttribute('aria-label', 'Trend: first 135, last 185 over 2 sessions');

    const polyline = svg.querySelector('polyline');
    expect(polyline).not.toBeNull();
    const pointsAttr = polyline?.getAttribute('points');
    expect(pointsAttr).toBeTruthy();
    expect(pointsAttr?.split(' ').length).toBe(2);
  });

  it('computes correct aria-label summary and polyline coordinates over N sessions', () => {
    const points = [135, 155, 145, 185, 205];
    render(<ExerciseSparkline points={points} testId="sparkline-n" />);

    const svg = screen.getByTestId('sparkline-n');
    expect(svg).toHaveAttribute('role', 'img');
    expect(svg).toHaveAttribute('aria-label', 'Trend: first 135, last 205 over 5 sessions');

    const polyline = svg.querySelector('polyline');
    const pointsAttr = polyline?.getAttribute('points');
    expect(pointsAttr?.split(' ').length).toBe(5);
  });

  it('handles flat trend (all points same value) gracefully without NaN or errors', () => {
    render(<ExerciseSparkline points={[200, 200, 200]} />);

    const svg = screen.getByRole('img');
    expect(svg).toHaveAttribute('aria-label', 'Trend: first 200, last 200 over 3 sessions');

    const polyline = svg.querySelector('polyline');
    const pointsAttr = polyline?.getAttribute('points');
    expect(pointsAttr).not.toContain('NaN');
  });

  it('applies custom dimensions and stroke styling', () => {
    render(
      <ExerciseSparkline
        points={[100, 150]}
        width={200}
        height={50}
        strokeWidth={3}
        className="text-cyan-400"
        testId="custom-sparkline"
      />
    );

    const svg = screen.getByTestId('custom-sparkline');
    expect(svg.getAttribute('viewBox')).toBe('0 0 200 50');
    expect(svg.getAttribute('class')).toContain('text-cyan-400');

    const polyline = svg.querySelector('polyline');
    expect(polyline?.getAttribute('stroke-width')).toBe('3');
  });

  it('formats weight with float drift in aria-label per STD-DAT-2', () => {
    // 135.50000000000003 -> 135.5, 185.50000000000003 -> 185.5 in lb mode
    render(<ExerciseSparkline points={[135.50000000000003, 185.50000000000003]} />);
    const svg = screen.getByRole('img');
    expect(svg).toHaveAttribute('aria-label', 'Trend: first 135.5, last 185.5 over 2 sessions');
    expect(svg.getAttribute('aria-label')).not.toContain('135.50000000000003');

    // In kg mode with showUnit
    render(<ExerciseSparkline points={[100, 150]} unit="kg" testId="sparkline-kg" />);
    const svgKg = screen.getByTestId('sparkline-kg');
    expect(svgKg).toHaveAttribute('aria-label', expect.stringContaining('kg'));
  });
});
