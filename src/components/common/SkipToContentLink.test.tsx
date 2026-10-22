import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SkipToContentLink } from './SkipToContentLink';

describe('SkipToContentLink (WCAG 2.4.1)', () => {
  it('renders anchor with exact text "Skip to main content" and default href "#main-content"', () => {
    render(<SkipToContentLink />);
    const link = screen.getByRole('link', { name: 'Skip to main content' });
    expect(link).toBeInTheDocument();
    expect(link.getAttribute('href')).toBe('#main-content');
  });

  it('includes sr-only and focus:not-sr-only classes for accessible visual hiding until focused', () => {
    render(<SkipToContentLink />);
    const link = screen.getByRole('link', { name: 'Skip to main content' });
    expect(link.className).toContain('sr-only');
    expect(link.className).toContain('focus:not-sr-only');
  });

  it('includes focus ring and theme styling matching the design system', () => {
    render(<SkipToContentLink />);
    const link = screen.getByRole('link', { name: 'Skip to main content' });
    expect(link.className).toContain('focus:ring-2');
    expect(link.className).toContain('focus:ring-cyan-400');
    expect(link.className).toContain('focus:bg-zinc-900');
    expect(link.className).toContain('focus:text-cyan-400');
    expect(link.className).toContain('focus:outline-none');
  });

  it('supports custom targetId prop and updates href accordingly', () => {
    render(<SkipToContentLink targetId="custom-content" />);
    const link = screen.getByRole('link', { name: 'Skip to main content' });
    expect(link.getAttribute('href')).toBe('#custom-content');
  });

  it('shifts focus to target element on click', () => {
    render(
      <div>
        <SkipToContentLink targetId="main-content" />
        <main id="main-content" tabIndex={-1}>
          <h1>Main Content</h1>
        </main>
      </div>
    );
    const link = screen.getByRole('link', { name: 'Skip to main content' });
    const main = screen.getByRole('main');
    const focusSpy = vi.spyOn(main, 'focus');

    fireEvent.click(link);
    expect(focusSpy).toHaveBeenCalledTimes(1);
  });
});
