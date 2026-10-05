import React from 'react';
import { Chip } from '../../common/Chip';
import {
  MUSCLE_GROUPS,
  EQUIPMENT,
  EQUIPMENT_LABELS,
  type Equipment,
} from '../../../constants/muscleGroups';

export interface PickerFilterChipsProps {
  selectedMuscleGroup: string | null;
  onSelectMuscleGroup: (group: string | null) => void;
  selectedEquipment: string | null;
  onSelectEquipment: (equipment: string | null) => void;
}

export const PickerFilterChips: React.FC<PickerFilterChipsProps> = ({
  selectedMuscleGroup,
  onSelectMuscleGroup,
  selectedEquipment,
  onSelectEquipment,
}) => {
  return (
    <div className="space-y-2.5">
      {/* Body Part Filter Chips */}
      <section
        className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar touch-manipulation"
        aria-label="Filter exercises by muscle group"
      >
        <Chip
          label="All Muscles"
          size="sm"
          selected={!selectedMuscleGroup || selectedMuscleGroup === 'all'}
          onClick={() => onSelectMuscleGroup(null)}
          testId="filter-chip-all-muscles"
        />
        {MUSCLE_GROUPS.map((group) => {
          const isSelected = selectedMuscleGroup === group;
          return (
            <Chip
              key={group}
              label={group}
              size="sm"
              selected={isSelected}
              onClick={() => onSelectMuscleGroup(isSelected ? null : group)}
              testId={`filter-chip-muscle-${group.toLowerCase().replace(/\s+/g, '-')}`}
            />
          );
        })}
      </section>

      {/* Equipment Filter Chips */}
      <section
        className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar touch-manipulation"
        aria-label="Filter exercises by equipment"
      >
        <Chip
          label="All Equipment"
          size="sm"
          selected={!selectedEquipment || selectedEquipment === 'all'}
          onClick={() => onSelectEquipment(null)}
          testId="filter-chip-all-equipment"
        />
        {EQUIPMENT.map((eq) => {
          const isSelected = selectedEquipment === eq;
          const label = EQUIPMENT_LABELS[eq as Equipment] || eq;
          return (
            <Chip
              key={eq}
              label={label}
              size="sm"
              selected={isSelected}
              onClick={() => onSelectEquipment(isSelected ? null : eq)}
              testId={`filter-chip-equipment-${eq}`}
            />
          );
        })}
      </section>
    </div>
  );
};
