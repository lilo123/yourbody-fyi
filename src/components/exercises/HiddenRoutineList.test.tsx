import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HiddenRoutineList } from './HiddenRoutineList';
import type { RoutineTemplate } from '../../types/database';

describe('HiddenRoutineList', () => {
  const hiddenTemplateA: RoutineTemplate = {
    id: 'tpl-hidden-1',
    user_id: 'master-user',
    name: 'Upper Body Power',
    is_master: true,
    assigned_to: null,
  };

  const hiddenTemplateB: RoutineTemplate = {
    id: 'tpl-hidden-2',
    user_id: 'master-user',
    name: 'Lower Body Hypertrophy',
    is_master: true,
    assigned_to: null,
  };

  it('renders unhide buttons with routine-specific accessible names for screen readers', () => {
    render(
      <HiddenRoutineList
        hiddenTemplates={[hiddenTemplateA, hiddenTemplateB]}
        isOnline={true}
        onUnhide={vi.fn()}
      />
    );

    const btnA = screen.getByRole('button', { name: 'Unhide Upper Body Power' });
    const btnB = screen.getByRole('button', { name: 'Unhide Lower Body Hypertrophy' });

    expect(btnA).toBeDefined();
    expect(btnB).toBeDefined();
    expect(btnA.textContent).toBe('Unhide');
    expect(btnB.textContent).toBe('Unhide');
  });

  it('satisfies 44px minimum touch target dimensions on unhide buttons', () => {
    render(
      <HiddenRoutineList
        hiddenTemplates={[hiddenTemplateA]}
        isOnline={true}
        onUnhide={vi.fn()}
      />
    );

    const unhideBtn = screen.getByTestId('unhide-template-tpl-hidden-1');
    expect(unhideBtn.className).toContain('min-h-[44px]');
    expect(unhideBtn.className).toContain('min-w-[44px]');
  });

  it('renders nothing when hiddenTemplates is empty', () => {
    const { container } = render(
      <HiddenRoutineList
        hiddenTemplates={[]}
        isOnline={true}
        onUnhide={vi.fn()}
      />
    );

    expect(container.firstChild).toBeNull();
  });

  it('calls onUnhide callback with the correct template when clicked', () => {
    const handleUnhide = vi.fn();
    render(
      <HiddenRoutineList
        hiddenTemplates={[hiddenTemplateA]}
        isOnline={true}
        onUnhide={handleUnhide}
      />
    );

    const unhideBtn = screen.getByTestId('unhide-template-tpl-hidden-1');
    fireEvent.click(unhideBtn);

    expect(handleUnhide).toHaveBeenCalledTimes(1);
    expect(handleUnhide).toHaveBeenCalledWith(hiddenTemplateA);
  });

  it('disables the button when offline and shows offline title', () => {
    render(
      <HiddenRoutineList
        hiddenTemplates={[hiddenTemplateA]}
        isOnline={false}
        onUnhide={vi.fn()}
      />
    );

    const unhideBtn = screen.getByTestId('unhide-template-tpl-hidden-1');
    expect(unhideBtn).toBeDisabled();
    expect(unhideBtn.getAttribute('title')).toBe('Available when online');
  });
});
