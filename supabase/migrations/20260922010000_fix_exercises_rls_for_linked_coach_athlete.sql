-- Exercises RLS: restore visibility between linked coaches and athletes.
--
-- When multi-coach linking landed (20260909000000_multi_coach_code_linking.sql) it rewrote the
-- RLS policies for workouts, sets, routine_templates and template_exercises to use the scoped
-- relationship helpers public.is_coach_of() / public.is_athlete_of(). public.exercises was missed.
--
-- Its SELECT policy still relies solely on public.is_coach(), which tests users.role = 'coach'.
-- Multi-coach accounts are marked with is_coach_mode = true and keep role = 'athlete', so
-- is_coach() returns false for them. That leaves a bidirectional blind spot:
--   * a coach cannot read their athlete's custom exercises, and
--   * an athlete cannot read the coach-authored exercises their own sets reference.
--
-- Rows the viewer may not read are simply absent from the catalog query rather than erroring, so
-- the client-side name resolution chain falls through to rendering the raw exercise_id UUID.
-- That is the user-visible symptom this fixes at the source.
--
-- Scope: both helpers only match rows in coach_athlete_links with status = 'active', so this
-- grants nothing between unlinked accounts. It does widen visibility to a linked counterparty's
-- whole custom catalog rather than only the exercises referenced by shared sets; that is
-- deliberate, since the coach exercise picker and template builder need the catalog, and the
-- exposed columns are exercise metadata only.
--
-- Deliberately unchanged: the INSERT / UPDATE / DELETE policies on public.exercises. The defect
-- is read-only visibility, and widening write access is a separate decision.

DROP POLICY IF EXISTS "Exercises viewable by master, owner, or coach" ON public.exercises;

CREATE POLICY "Exercises viewable by master, owner, or coach" ON public.exercises
  FOR SELECT
  USING (
    is_master = true
    OR user_id = auth.uid()
    OR public.is_coach()
    OR public.is_coach_of(user_id)
    OR public.is_athlete_of(user_id)
  );
