/**
 * Canonical Muscle Groups and Equipment Taxonomy
 *
 * Single source of truth for body parts, equipment, and category synonyms.
 * Covers all production database body_parts values:
 * Back, Chest, Shoulders, Core, Legs, Arms, Biceps, Triceps.
 */

export const MUSCLE_GROUPS = [
  'Chest',
  'Back',
  'Legs',
  'Shoulders',
  'Arms',
  'Biceps',
  'Triceps',
  'Core',
  'Cardio',
  'Full Body',
] as const;

export type MuscleGroup = (typeof MUSCLE_GROUPS)[number];

export const MUSCLE_GROUP_LABELS: Record<MuscleGroup, string> = {
  Chest: 'Chest',
  Back: 'Back',
  Legs: 'Legs',
  Shoulders: 'Shoulders',
  Arms: 'Arms',
  Biceps: 'Biceps',
  Triceps: 'Triceps',
  Core: 'Core',
  Cardio: 'Cardio',
  'Full Body': 'Full Body',
};

/**
 * Supported equipment types matching migration 20260927030000_exercise_catalog.sql CHECK constraint.
 */
export const EQUIPMENT = [
  'barbell',
  'dumbbell',
  'machine',
  'cable',
  'bodyweight',
  'kettlebell',
  'band',
  'smith',
  'other',
] as const;

export type Equipment = (typeof EQUIPMENT)[number];

export const EQUIPMENT_LABELS: Record<Equipment, string> = {
  barbell: 'Barbell',
  dumbbell: 'Dumbbell',
  machine: 'Machine',
  cable: 'Cable',
  bodyweight: 'Bodyweight',
  kettlebell: 'Kettlebell',
  band: 'Band',
  smith: 'Smith Machine',
  other: 'Other',
};

export const CATEGORY_SYNONYMS: Record<string, MuscleGroup> = {
  abs: 'Core',
  abdominals: 'Core',
  quads: 'Legs',
  quadriceps: 'Legs',
  hamstrings: 'Legs',
  hamstring: 'Legs',
  calves: 'Legs',
  glutes: 'Legs',
  lats: 'Back',
  delts: 'Shoulders',
  bicep: 'Biceps',
  tricep: 'Triceps',
};

export function getEquipmentLabel(equipment?: string | null): string {
  if (!equipment) return '';
  return EQUIPMENT_LABELS[equipment as Equipment] || equipment;
}

export function getMuscleGroupLabel(group?: string | null): string {
  if (!group) return '';
  return MUSCLE_GROUP_LABELS[group as MuscleGroup] || group;
}
