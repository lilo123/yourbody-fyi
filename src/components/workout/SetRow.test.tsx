import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SetRow } from './SetRow';
import type { WorkoutSet } from '../../types/database';
import { expectNoA11yViolations } from '../../test/a11y';
import { AuthContext, type AuthContextType } from '../../context/AuthContextTypes';

const createAuthContextValue = (weightUnit: 'lb' | 'kg' = 'lb'): AuthContextType => ({
  user: { id: 'test-user-id' } as any,
  profile: { id: 'test-user-id', weight_unit: weightUnit } as any,
  role: 'athlete',
  viewMode: 'athlete',
  isCoachMode: false,
  loading: false,
  signIn: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
  updateProfile: vi.fn(),
  switchRole: vi.fn(),
  refreshProfile: vi.fn(),
  resendConfirmation: vi.fn(),
  requestPasswordReset: vi.fn(),
  resetPassword: vi.fn(),
});

function renderWithAuth(ui: React.ReactElement, weightUnit: 'lb' | 'kg' = 'lb') {
  return render(
    <AuthContext.Provider value={createAuthContextValue(weightUnit)}>
      {ui}
    </AuthContext.Provider>
  );
}

describe('SetRow', () => {
  const defaultGhost = {
    weight: 135,
    reps: 10,
    hintText: '135 lbs × 10',
    isFromPrevious: true,
  };

  const loggedSet: WorkoutSet = {
    id: 'set-1',
    workout_id: 'workout-1',
    exercise_id: 'bench-press',
    set_index: 3,
    weight: 185,
    reps: 8,
    set_type: 'working',
    rpe: null,
    created_at: new Date().toISOString(),
  };

  describe('Logged Set', () => {
    it('tapping a logged row calls onEditSet and does not delete', () => {
      const onEditSet = vi.fn();
      const onCommitSet = vi.fn();
      const onUpdateDraft = vi.fn();

      renderWithAuth(
        <SetRow
          exName="Bench Press"
          exIndex={0}
          rowIdx={0}
          setIndex={1}
          loggedSet={loggedSet}
          ghost={defaultGhost}
          draftWeight=""
          draftReps=""
          isMutating={false}
          onUpdateDraft={onUpdateDraft}
          onCommitSet={onCommitSet}
          onEditSet={onEditSet}
        />
      );

      const loggedRow = screen.getByTestId('logged-set-row-0-0');
      expect(loggedRow).toBeInTheDocument();
      expect(screen.queryByTestId('delete-set-btn-0-0')).toBeNull();

      fireEvent.click(loggedRow);
      expect(onEditSet).toHaveBeenCalledTimes(1);
      expect(onEditSet).toHaveBeenCalledWith(0, 0);
      expect(onCommitSet).not.toHaveBeenCalled();
    });

    it('displays logged set index from loggedSet.set_index', () => {
      renderWithAuth(
        <SetRow
          exName="Bench Press"
          exIndex={0}
          rowIdx={0}
          setIndex={1}
          loggedSet={loggedSet}
          ghost={defaultGhost}
          draftWeight=""
          draftReps=""
          isMutating={false}
          onUpdateDraft={vi.fn()}
          onCommitSet={vi.fn()}
        />
      );

      // set_index is 3, even though setIndex prop is 1
      expect(screen.getByText('3')).toBeInTheDocument();
    });

    it('formats bodyweight as BW', () => {
      const bwLoggedSet: WorkoutSet = {
        ...loggedSet,
        weight: 0,
        reps: 12,
      };

      renderWithAuth(
        <SetRow
          exName="Pull Up"
          exIndex={0}
          rowIdx={0}
          setIndex={1}
          loggedSet={bwLoggedSet}
          ghost={{ ...defaultGhost, weight: 0 }}
          draftWeight=""
          draftReps=""
          isMutating={false}
          onUpdateDraft={vi.fn()}
          onCommitSet={vi.fn()}
        />
      );

      expect(screen.getByText('BW')).toBeInTheDocument();
      expect(screen.getByText('12')).toBeInTheDocument();
    });

    it('renders logged value boxes with h-11 and text-base font-semibold matching pending inputs (HF-A)', () => {
      renderWithAuth(
        <SetRow
          exName="Bench Press"
          exIndex={0}
          rowIdx={0}
          setIndex={1}
          loggedSet={loggedSet}
          ghost={defaultGhost}
          draftWeight=""
          draftReps=""
          isMutating={false}
          onUpdateDraft={vi.fn()}
          onCommitSet={vi.fn()}
          onEditSet={vi.fn()}
        />
      );

      const loggedRow = screen.getByTestId("logged-set-row-0-0");
      expect(loggedRow.className).toContain("py-0.5");
      // Find weight and reps boxes
      const boxes = loggedRow.querySelectorAll("div.rounded-lg.tabular-nums");
      expect(boxes.length).toBeGreaterThanOrEqual(2);
      boxes.forEach((box) => {
        expect(box.className).toContain("h-11");
        expect(box.className).toContain("text-base");
        expect(box.className).toContain("font-semibold");
      });
    });

    it('satisfies a11y standards on logged row', async () => {
      const { container } = renderWithAuth(
        <SetRow
          exName="Bench Press"
          exIndex={0}
          rowIdx={0}
          setIndex={1}
          loggedSet={loggedSet}
          ghost={defaultGhost}
          draftWeight=""
          draftReps=""
          isMutating={false}
          onUpdateDraft={vi.fn()}
          onCommitSet={vi.fn()}
          onEditSet={vi.fn()}
        />
      );

      await expectNoA11yViolations(container);
    });
  });

  describe('Pending / Draft Set', () => {
    it('provides 16px inputs, enterKeyHint and select-on-focus', () => {
      renderWithAuth(
        <SetRow
          exName="Bench Press"
          exIndex={0}
          rowIdx={0}
          setIndex={1}
          ghost={defaultGhost}
          draftWeight="135"
          draftReps="10"
          isMutating={false}
          onUpdateDraft={vi.fn()}
          onCommitSet={vi.fn()}
        />
      );

      const weightInput = screen.getByTestId('ghost-weight-0-0') as HTMLInputElement;
      const repsInput = screen.getByTestId('ghost-reps-0-0') as HTMLInputElement;

      expect(weightInput.className).toContain('text-base');
      expect(weightInput).toHaveAttribute('enterKeyHint', 'next');
      expect(weightInput).toHaveAttribute('inputMode', 'decimal');

      expect(repsInput.className).toContain('text-base');
      expect(repsInput).toHaveAttribute('enterKeyHint', 'done');
      expect(repsInput).toHaveAttribute('inputMode', 'numeric');
    });

    it('navigates from weight to reps on Enter and commits on Enter in reps', () => {
      const onCommitSet = vi.fn();
      renderWithAuth(
        <SetRow
          exName="Bench Press"
          exIndex={0}
          rowIdx={0}
          setIndex={1}
          ghost={defaultGhost}
          draftWeight="135"
          draftReps="10"
          isMutating={false}
          onUpdateDraft={vi.fn()}
          onCommitSet={onCommitSet}
        />
      );

      const weightInput = screen.getByTestId('ghost-weight-0-0');
      const repsInput = screen.getByTestId('ghost-reps-0-0');

      // Enter in weight focuses reps
      fireEvent.keyDown(weightInput, { key: 'Enter', code: 'Enter' });
      expect(document.activeElement).toBe(repsInput);
      expect(onCommitSet).not.toHaveBeenCalled();

      // Enter in reps triggers commit
      fireEvent.keyDown(repsInput, { key: 'Enter', code: 'Enter' });
      expect(onCommitSet).toHaveBeenCalledTimes(1);
      expect(onCommitSet).toHaveBeenCalledWith('Bench Press', 1, defaultGhost);
    });

    it('commits set on one-tap check button click', () => {
      const onCommitSet = vi.fn();
      renderWithAuth(
        <SetRow
          exName="Bench Press"
          exIndex={0}
          rowIdx={0}
          setIndex={1}
          ghost={defaultGhost}
          draftWeight="135"
          draftReps="10"
          isMutating={false}
          onUpdateDraft={vi.fn()}
          onCommitSet={onCommitSet}
        />
      );

      const commitBtn = screen.getByTestId('commit-set-btn-0-0');
      fireEvent.click(commitBtn);
      expect(onCommitSet).toHaveBeenCalledWith('Bench Press', 1, defaultGhost);
    });

    it('after commit, moves focus to next pending set weight input (or reps if weight prefilled)', async () => {
      vi.useFakeTimers();
      const onCommitSet = vi.fn();
      renderWithAuth(
        <div>
          <SetRow
            exName="Bench Press"
            exIndex={0}
            rowIdx={0}
            setIndex={1}
            ghost={defaultGhost}
            draftWeight="185"
            draftReps="8"
            isMutating={false}
            onUpdateDraft={vi.fn()}
            onCommitSet={onCommitSet}
          />
          <SetRow
            exName="Bench Press"
            exIndex={0}
            rowIdx={1}
            setIndex={2}
            ghost={defaultGhost}
            draftWeight=""
            draftReps=""
            isMutating={false}
            onUpdateDraft={vi.fn()}
            onCommitSet={vi.fn()}
          />
        </div>
      );

      const repsInput0 = screen.getByTestId('ghost-reps-0-0');
      fireEvent.keyDown(repsInput0, { key: 'Enter', code: 'Enter' });

      expect(onCommitSet).toHaveBeenCalledWith('Bench Press', 1, defaultGhost);

      vi.runAllTimers();

      const nextWeightInput = screen.getByTestId('ghost-weight-0-1');
      expect(document.activeElement).toBe(nextWeightInput);

      vi.useRealTimers();
    });

    it('moves focus to reps input if next pending set weight is prefilled', async () => {
      vi.useFakeTimers();
      renderWithAuth(
        <div>
          <SetRow
            exName="Bench Press"
            exIndex={0}
            rowIdx={0}
            setIndex={1}
            ghost={defaultGhost}
            draftWeight="185"
            draftReps="8"
            isMutating={false}
            onUpdateDraft={vi.fn()}
            onCommitSet={vi.fn()}
          />
          <SetRow
            exName="Bench Press"
            exIndex={0}
            rowIdx={1}
            setIndex={2}
            ghost={defaultGhost}
            draftWeight="200"
            draftReps=""
            isMutating={false}
            onUpdateDraft={vi.fn()}
            onCommitSet={vi.fn()}
          />
        </div>
      );

      const commitBtn0 = screen.getByTestId('commit-set-btn-0-0');
      fireEvent.click(commitBtn0);

      vi.runAllTimers();

      const nextRepsInput = screen.getByTestId('ghost-reps-0-1');
      expect(document.activeElement).toBe(nextRepsInput);

      vi.useRealTimers();
    });

    it('does not steal focus when a dialog or sheet is open', async () => {
      vi.useFakeTimers();
      renderWithAuth(
        <div>
          <div role="dialog" aria-modal="true">
            <button data-testid="dialog-btn">Dialog button</button>
          </div>
          <SetRow
            exName="Bench Press"
            exIndex={0}
            rowIdx={0}
            setIndex={1}
            ghost={defaultGhost}
            draftWeight="185"
            draftReps="8"
            isMutating={false}
            onUpdateDraft={vi.fn()}
            onCommitSet={vi.fn()}
          />
          <SetRow
            exName="Bench Press"
            exIndex={0}
            rowIdx={1}
            setIndex={2}
            ghost={defaultGhost}
            draftWeight=""
            draftReps=""
            isMutating={false}
            onUpdateDraft={vi.fn()}
            onCommitSet={vi.fn()}
          />
        </div>
      );

      const dialogBtn = screen.getByTestId('dialog-btn');
      dialogBtn.focus();
      expect(document.activeElement).toBe(dialogBtn);

      const commitBtn0 = screen.getByTestId('commit-set-btn-0-0');
      fireEvent.click(commitBtn0);

      vi.runAllTimers();

      // Focus was NOT stolen away from dialog button to next set
      expect(document.activeElement).toBe(dialogBtn);

      vi.useRealTimers();
    });

    it('satisfies a11y standards on pending row', async () => {
      const { container } = renderWithAuth(
        <SetRow
          exName="Bench Press"
          exIndex={0}
          rowIdx={0}
          setIndex={1}
          ghost={defaultGhost}
          draftWeight=""
          draftReps=""
          isMutating={false}
          onUpdateDraft={vi.fn()}
          onCommitSet={vi.fn()}
        />
      );

      await expectNoA11yViolations(container);
    });

    it('displays 102.1 for 225 lb logged set in kg mode', () => {
      const kgLoggedSet: WorkoutSet = {
        ...loggedSet,
        weight: 225,
        reps: 5,
      };

      renderWithAuth(
        <SetRow
          exName="Bench Press"
          exIndex={0}
          rowIdx={0}
          setIndex={1}
          loggedSet={kgLoggedSet}
          ghost={defaultGhost}
          draftWeight=""
          draftReps=""
          isMutating={false}
          onUpdateDraft={vi.fn()}
          onCommitSet={vi.fn()}
        />,
        'kg'
      );

      expect(screen.getByText('102.1')).toBeInTheDocument();
    });

    it('renders suffix kg in placeholder when ghost weight is absent in kg mode', () => {
      renderWithAuth(
        <SetRow
          exName="Bench Press"
          exIndex={0}
          rowIdx={0}
          setIndex={1}
          ghost={{ weight: '', reps: '', hintText: '—', isFromPrevious: false }}
          draftWeight=""
          draftReps=""
          isMutating={false}
          onUpdateDraft={vi.fn()}
          onCommitSet={vi.fn()}
        />,
        'kg'
      );

      const weightInput = screen.getByTestId('ghost-weight-0-0');
      expect(weightInput).toHaveAttribute('placeholder', 'kg');
    });

    it('renders pending mark when loggedSet carries pending: true', () => {
      const pendingSet = { ...loggedSet, pending: true };
      renderWithAuth(
        <SetRow
          exName="Bench Press"
          exIndex={0}
          rowIdx={0}
          setIndex={3}
          loggedSet={pendingSet as any}
          ghost={defaultGhost}
          draftWeight=""
          draftReps=""
          isMutating={false}
          onUpdateDraft={vi.fn()}
          onCommitSet={vi.fn()}
        />
      );

      const pendingMark = screen.getByTestId('pending-mark');
      expect(pendingMark).toBeInTheDocument();
      expect(pendingMark).toHaveAttribute('aria-label', 'Not synced yet');
    });

    it('does not render pending mark when loggedSet carries pending: false or undefined', () => {
      renderWithAuth(
        <SetRow
          exName="Bench Press"
          exIndex={0}
          rowIdx={0}
          setIndex={3}
          loggedSet={loggedSet}
          ghost={defaultGhost}
          draftWeight=""
          draftReps=""
          isMutating={false}
          onUpdateDraft={vi.fn()}
          onCommitSet={vi.fn()}
        />
      );

      expect(screen.queryByTestId('pending-mark')).toBeNull();
    });
  });
});

