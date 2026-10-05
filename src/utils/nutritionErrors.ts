/**
 * Postgres check-constraint violations arrive as
 * `new row for relation "nutrition_logs" violates check constraint "chk_..."`,
 * which is not something to put in front of a user. R-31: an out-of-date
 * client (the stale Android build in particular) will hit these, so the
 * message has to say what to do, not what broke.
 *
 * This lives in utils rather than in EditMealModal because MealLogRow needs the
 * same text when an inline component edit is rejected, and importing a modal
 * component purely for a string helper would drag the Supabase client and
 * react-query into every consumer's module graph.
 */
export function friendlyError(err: any): string {
  const raw: string = typeof err === 'string' ? err : err?.message || '';
  if (raw.includes('chk_nl_parent_equals_items_sum') || raw.includes('chk_cd_parent_equals_items_sum')) {
    return "This meal's totals no longer match its components. Reopen the meal and adjust the components instead.";
  }
  if (raw.includes('chk_nl_items_shape') || raw.includes('chk_cd_items_shape')) {
    return 'This meal has an invalid breakdown (a component is missing a name or has a negative value).';
  }
  if (raw.includes('_non_negative')) {
    return 'Macros cannot be negative.';
  }
  if (/row-level security|permission denied/i.test(raw)) {
    return 'You do not have permission to change this meal.';
  }
  return raw || 'Failed to update meal log. Please try again.';
}
