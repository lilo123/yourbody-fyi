import { describe, it, expect } from 'vitest';
import {
  MUSCLE_GROUPS,
  EQUIPMENT,
  EQUIPMENT_LABELS,
  MUSCLE_GROUP_LABELS,
  CATEGORY_SYNONYMS,
  getEquipmentLabel,
  getMuscleGroupLabel,
} from './muscleGroups';

describe('muscleGroups constants', () => {
  it('covers all production database body_parts values', () => {
    const requiredProductionParts = [
      'Back',
      'Chest',
      'Shoulders',
      'Core',
      'Legs',
      'Arms',
      'Biceps',
      'Triceps',
    ];
    for (const part of requiredProductionParts) {
      expect(MUSCLE_GROUPS).toContain(part);
    }
  });

  it('covers all migration equipment CHECK values', () => {
    const migrationEquipment = [
      'barbell',
      'dumbbell',
      'machine',
      'cable',
      'bodyweight',
      'kettlebell',
      'band',
      'smith',
      'other',
    ];
    expect(EQUIPMENT).toEqual(migrationEquipment);
  });

  it('provides human-readable labels for all equipment options', () => {
    for (const eq of EQUIPMENT) {
      expect(EQUIPMENT_LABELS[eq]).toBeDefined();
      expect(typeof EQUIPMENT_LABELS[eq]).toBe('string');
      expect(getEquipmentLabel(eq)).toBe(EQUIPMENT_LABELS[eq]);
    }
    expect(getEquipmentLabel(null)).toBe('');
    expect(getEquipmentLabel(undefined)).toBe('');
  });

  it('provides labels for all muscle groups', () => {
    for (const mg of MUSCLE_GROUPS) {
      expect(MUSCLE_GROUP_LABELS[mg]).toBeDefined();
      expect(getMuscleGroupLabel(mg)).toBe(MUSCLE_GROUP_LABELS[mg]);
    }
    expect(getMuscleGroupLabel(null)).toBe('');
    expect(getMuscleGroupLabel(undefined)).toBe('');
  });

  it('maps category synonyms to valid muscle groups', () => {
    for (const [syn, targetGroup] of Object.entries(CATEGORY_SYNONYMS)) {
      expect(typeof syn).toBe('string');
      expect(MUSCLE_GROUPS).toContain(targetGroup);
    }
    expect(CATEGORY_SYNONYMS.abs).toBe('Core');
    expect(CATEGORY_SYNONYMS.lats).toBe('Back');
    expect(CATEGORY_SYNONYMS.delts).toBe('Shoulders');
  });
});
