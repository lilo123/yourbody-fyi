import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ExerciseListRow, type ExerciseRowItem } from './ExerciseListRow';

describe('ExerciseListRow', () => {
  const masterExercise: ExerciseRowItem = {
    id: 'ex-master-1',
    name: 'Zercher Squat',
    body_parts: ['Legs'],
    equipment: 'barbell',
    is_master: true,
    user_id: null,
    is_archived: false,
    is_hidden: false,
  };

  const userExercise: ExerciseRowItem = {
    id: 'ex-user-1',
    name: 'Romanian Deadlift',
    body_parts: ['Legs'],
    equipment: 'barbell',
    is_master: false,
    user_id: 'user-123',
    is_archived: false,
    is_hidden: false,
  };

  it('renders exercise name, body part, and equipment subtitle', () => {
    render(
      <ExerciseListRow
        exercise={masterExercise}
        currentUserId="user-123"
      />
    );

    const nameSpan = screen.getByText('Zercher Squat');
    expect(nameSpan).toBeDefined();
    expect(nameSpan.className).toContain('truncate');

    expect(screen.getByText('Legs')).toBeDefined();
    expect(screen.getByTestId('exercise-row-subtitle').textContent).toBe('Legs');
    expect(screen.getByText('Barbell')).toBeDefined();
  });

  it('renders joined body_parts in subtitle', () => {
    const multiBodyPartEx: ExerciseRowItem = {
      ...masterExercise,
      body_parts: ['Chest', 'Triceps'],
      };
    render(
      <ExerciseListRow
        exercise={multiBodyPartEx}
        currentUserId="user-123"
      />
    );
    expect(screen.getByTestId('exercise-row-subtitle').textContent).toBe('Chest · Triceps');
  });

  it('renders Default owner pill for master exercises', () => {
    render(
      <ExerciseListRow
        exercise={masterExercise}
        currentUserId="user-123"
      />
    );
    expect(screen.getByTestId('tag-default-ex-master-1')).toBeDefined();
    expect(screen.getByText('Default')).toBeDefined();
  });

  it('renders You owner pill for own exercises', () => {
    render(
      <ExerciseListRow
        exercise={userExercise}
        currentUserId="user-123"
      />
    );
    expect(screen.getByTestId('tag-you-ex-user-1')).toBeDefined();
    expect(screen.getByText('You')).toBeDefined();
  });

  it('renders athlete name pill for coach viewing athlete exercise', () => {
    const athleteExercise: ExerciseRowItem = {
      ...userExercise,
      user_id: 'athlete-456',
    };

    render(
      <ExerciseListRow
        exercise={athleteExercise}
        currentUserId="coach-999"
        isCoach={true}
        athleteFirstName="Alex"
      />
    );
    expect(screen.getByTestId('tag-athlete-ex-user-1')).toBeDefined();
    expect(screen.getByText('Alex')).toBeDefined();
  });

  it('renders From coach pill for athlete viewing coach exercise', () => {
    const coachExercise: ExerciseRowItem = {
      ...userExercise,
      user_id: 'coach-999',
    };

    render(
      <ExerciseListRow
        exercise={coachExercise}
        currentUserId="athlete-456"
        isCoach={false}
      />
    );
    expect(screen.getByTestId('tag-coach-ex-user-1')).toBeDefined();
    expect(screen.getByText('From coach')).toBeDefined();
  });

  it('renders Archived and Hidden status tags', () => {
    const archivedExercise: ExerciseRowItem = {
      ...userExercise,
      is_archived: true,
      is_hidden: true,
    };

    render(
      <ExerciseListRow
        exercise={archivedExercise}
        currentUserId="user-123"
      />
    );
    expect(screen.getByTestId('tag-archived-ex-user-1')).toBeDefined();
    expect(screen.getByTestId('tag-hidden-ex-user-1')).toBeDefined();
  });

  it('enforces 44px min hit targets on all action buttons (L21)', () => {
    render(
      <ExerciseListRow
        exercise={userExercise}
        currentUserId="user-123"
        onEdit={vi.fn()}
        onArchive={vi.fn()}
      />
    );

    const editBtn = screen.getByTestId('edit-exercise-ex-user-1');
    const archiveBtn = screen.getByTestId('archive-exercise-ex-user-1');

    expect(editBtn.className).toContain('min-w-[44px]');
    expect(editBtn.className).toContain('min-h-[44px]');
    expect(archiveBtn.className).toContain('min-w-[44px]');
    expect(archiveBtn.className).toContain('min-h-[44px]');
  });

  it('L13: double-tap protection disables buttons once clicked', () => {
    const onArchiveMock = vi.fn();
    render(
      <ExerciseListRow
        exercise={userExercise}
        currentUserId="user-123"
        onArchive={onArchiveMock}
      />
    );

    const archiveBtn = screen.getByTestId('archive-exercise-ex-user-1');
    expect(archiveBtn).not.toBeDisabled();

    fireEvent.click(archiveBtn);
    expect(onArchiveMock).toHaveBeenCalledTimes(1);
    expect(archiveBtn).toBeDisabled();

    // Second click should not call onArchiveMock again
    fireEvent.click(archiveBtn);
    expect(onArchiveMock).toHaveBeenCalledTimes(1);
  });

  it('triggers onRestore when Restore button clicked on archived row', () => {
    const onRestoreMock = vi.fn();
    render(
      <ExerciseListRow
        exercise={{ ...userExercise, is_archived: true }}
        currentUserId="user-123"
        onRestore={onRestoreMock}
      />
    );

    const restoreBtn = screen.getByTestId('restore-exercise-ex-user-1');
    fireEvent.click(restoreBtn);
    expect(onRestoreMock).toHaveBeenCalledWith(expect.objectContaining({ id: 'ex-user-1' }));
  });

  it('triggers onUnhide when Unhide button clicked on hidden row', () => {
    const onUnhideMock = vi.fn();
    render(
      <ExerciseListRow
        exercise={{ ...masterExercise, is_hidden: true }}
        currentUserId="user-123"
        onUnhide={onUnhideMock}
      />
    );

    const unhideBtn = screen.getByTestId('unhide-exercise-ex-master-1');
    fireEvent.click(unhideBtn);
    expect(onUnhideMock).toHaveBeenCalledWith(expect.objectContaining({ id: 'ex-master-1' }));
  });
});
