import React from 'react';
import { Bed, Calendar, Dumbbell } from 'lucide-react';
import { Button } from '../common/Button';

export interface RestDayViewProps {
  onOpenRoutineModal: () => void;
  onLogActivity?: () => void;
}

export const RestDayView: React.FC<RestDayViewProps> = ({
  onOpenRoutineModal,
  onLogActivity,
}) => {
  return (
    <div className="bg-gradient-to-br from-indigo-950/40 via-zinc-900/90 to-zinc-950 border border-indigo-500/30 rounded-3xl p-8 text-center text-white shadow-2xl my-2">
      <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center mx-auto mb-4 text-indigo-400 text-2xl shadow-[0_0_20px_rgba(99,102,241,0.25)]">
        <Bed className="w-8 h-8" aria-hidden="true" />
      </div>
      <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 text-xs font-bold uppercase tracking-wider mb-2.5">
        <Calendar className="w-3.5 h-3.5" aria-hidden="true" /> Rest Day
      </div>
      <h2 className="text-sm font-bold text-white mb-1.5">Rest & Recovery</h2>
      <p className="text-xs text-zinc-400 max-w-sm mx-auto mb-6 leading-relaxed">
        Take today to rest and recover, stretch, or choose a routine if you want to train today.
      </p>
      <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
        <Button
          variant="primary"
          size="md"
          onClick={onOpenRoutineModal}
          leftIcon={<Dumbbell className="w-4 h-4 shrink-0" aria-hidden="true" />}
        >
          Choose Routine
        </Button>
        {onLogActivity && (
          <Button
            variant="secondary"
            size="md"
            onClick={onLogActivity}
          >
            Log activity anyway
          </Button>
        )}
      </div>
    </div>
  );
};
