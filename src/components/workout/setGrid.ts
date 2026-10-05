/**
 * Single source of truth for the 5-column exercise set grid:
 * [Set, Previous, Weight, Reps, Log]
 *
 * Balanced across 320px, 390px, and 430px viewports so that:
 * 1. Previous hint has sufficient space without truncation at 320px.
 * 2. Weight and Reps columns scale evenly and center their headers over inputs.
 * 3. Weight/reps inputs and commit button maintain >= 44x44 raw px touch targets.
 * 4. Used identically by ExerciseCard table header and SetRow (both logged & pending).
 */
export const SET_GRID_TEMPLATE = 'grid-cols-[20px_minmax(0,1.6fr)_minmax(48px,1fr)_minmax(46px,1fr)_32px]';
