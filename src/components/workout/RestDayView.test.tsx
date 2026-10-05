import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RestDayView } from './RestDayView';
import { expectNoA11yViolations } from '../../test/a11y';

describe('RestDayView', () => {
  it('renders Rest & Recovery heading and Choose Routine button', () => {
    const onOpen = vi.fn();
    render(<RestDayView onOpenRoutineModal={onOpen} />);

    expect(screen.getByRole('heading', { name: /rest & recovery/i })).toBeInTheDocument();
    const chooseBtn = screen.getByRole('button', { name: /choose routine/i });
    expect(chooseBtn).toBeInTheDocument();
    expect(chooseBtn.className).toContain('min-h-[44px]');

    fireEvent.click(chooseBtn);
    expect(onOpen).toHaveBeenCalledTimes(1);

    // "Log activity anyway" button is not rendered when prop omitted
    expect(screen.queryByRole('button', { name: /log activity anyway/i })).toBeNull();
  });

  it('renders "Log activity anyway" secondary button when onLogActivity is provided', () => {
    const onOpen = vi.fn();
    const onLog = vi.fn();
    render(<RestDayView onOpenRoutineModal={onOpen} onLogActivity={onLog} />);

    const logBtn = screen.getByRole('button', { name: /log activity anyway/i });
    expect(logBtn).toBeInTheDocument();
    expect(logBtn.className).toContain('min-h-[44px]');

    fireEvent.click(logBtn);
    expect(onLog).toHaveBeenCalledTimes(1);
  });

  it('satisfies STD-TYP with no font-black in markup', () => {
    const { container } = render(<RestDayView onOpenRoutineModal={vi.fn()} />);
    expect(container.innerHTML).not.toContain('font-black');
  });

  it('passes axe accessibility scan with no violations', async () => {
    const { container } = render(
      <RestDayView onOpenRoutineModal={vi.fn()} onLogActivity={vi.fn()} />
    );
    await expectNoA11yViolations(container);
  });
});
