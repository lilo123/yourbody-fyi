import React from 'react';
import type { RoutineTemplate } from '../../types/database';
import { Tag } from '../common/Tag';

export interface HiddenRoutineListProps {
  hiddenTemplates: RoutineTemplate[];
  isOnline: boolean;
  onUnhide: (template: RoutineTemplate) => void;
}

export const HiddenRoutineList: React.FC<HiddenRoutineListProps> = ({
  hiddenTemplates,
  isOnline,
  onUnhide,
}) => {
  if (hiddenTemplates.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2" data-testid="hidden-routines-list">
      {hiddenTemplates.map((template) => (
        <div
          key={template.id}
          data-testid={`hidden-template-${template.id}`}
          className="bg-zinc-900/50 border border-zinc-800/80 rounded-xl p-4 text-sm font-medium flex justify-between items-center gap-3"
        >
          <div className="min-w-0 flex-1 flex items-center gap-2 flex-wrap">
            <span className="text-zinc-100 font-bold truncate text-sm">{template.name}</span>
            <Tag label="Master" tone="info" testId={`tag-master-hidden-${template.id}`} />
          </div>
          <button
            type="button"
            disabled={!isOnline}
            title={!isOnline ? 'Available when online' : 'Unhide'}
            data-testid={`unhide-template-${template.id}`}
            aria-label="Unhide"
            onClick={() => onUnhide(template)}
            className="px-3 py-1.5 min-h-[36px] bg-zinc-800 hover:bg-zinc-700 text-zinc-200 hover:text-white font-semibold text-xs rounded-lg transition touch-manipulation cursor-pointer disabled:opacity-50"
          >
            Unhide
          </button>
        </div>
      ))}
    </div>
  );
};
