import { useState, useRef, useCallback, useEffect } from 'react';
import type { RoutineTemplate } from '../../types/database';

export interface UseRoutineSelectionOptions {
  selectRoutineInternal: (routineName: string, template?: RoutineTemplate) => Promise<void>;
  cancelRoutineSelection: () => void;
  workoutDate?: string;
}

export interface UseRoutineSelectionReturn {
  showRoutineModal: boolean;
  setShowRoutineModal: (open: boolean) => void;
  isSelectingRoutine: boolean;
  handleSelectRoutine: (routineName: string, template?: RoutineTemplate) => Promise<void>;
  handleCloseRoutineModal: () => void;
}

export function useRoutineSelection({
  selectRoutineInternal,
  cancelRoutineSelection,
  workoutDate,
}: UseRoutineSelectionOptions): UseRoutineSelectionReturn {
  const [showRoutineModal, setShowRoutineModal] = useState<boolean>(false);
  const [isSelectingRoutine, setIsSelectingRoutine] = useState<boolean>(false);
  const routineSelectSeqRef = useRef<number>(0);
  const isFirstMountRef = useRef<boolean>(true);

  // Date change during in-flight pick: bump sequence counter, cancel selection, clear busy state
  useEffect(() => {
    if (isFirstMountRef.current) {
      isFirstMountRef.current = false;
      return;
    }
    routineSelectSeqRef.current++;
    cancelRoutineSelection();
    setIsSelectingRoutine(false);
  }, [workoutDate, cancelRoutineSelection]);

  // Unmount: bump sequence counter and cancel selection
  useEffect(() => {
    return () => {
      routineSelectSeqRef.current++;
      cancelRoutineSelection();
    };
  }, [cancelRoutineSelection]);

  const handleSelectRoutine = useCallback(
    async (routineName: string, template?: RoutineTemplate) => {
      const seq = ++routineSelectSeqRef.current;
      setIsSelectingRoutine(true);
      try {
        await selectRoutineInternal(routineName, template);
      } finally {
        if (seq === routineSelectSeqRef.current) {
          setIsSelectingRoutine(false);
          setShowRoutineModal(false);
        }
      }
    },
    [selectRoutineInternal]
  );

  const handleCloseRoutineModal = useCallback(() => {
    routineSelectSeqRef.current++;
    cancelRoutineSelection();
    setIsSelectingRoutine(false);
    setShowRoutineModal(false);
  }, [cancelRoutineSelection]);

  return {
    showRoutineModal,
    setShowRoutineModal,
    isSelectingRoutine,
    handleSelectRoutine,
    handleCloseRoutineModal,
  };
}
