-- Migration: 20261031000000_master_templates_owner_only_writes.sql
-- Restrict UPDATE and DELETE on routine_templates and template_exercises to owner only

-- 1. routine_templates: owner-only UPDATE and DELETE
DROP POLICY IF EXISTS "Routine templates update policy" ON public.routine_templates;
CREATE POLICY "Routine templates update policy" ON public.routine_templates FOR UPDATE TO authenticated USING (
  user_id = auth.uid()
) WITH CHECK (
  user_id = auth.uid() AND (assigned_to IS NULL OR assigned_to = auth.uid() OR public.is_coach_of(assigned_to))
);

DROP POLICY IF EXISTS "Routine templates delete policy" ON public.routine_templates;
CREATE POLICY "Routine templates delete policy" ON public.routine_templates FOR DELETE TO authenticated USING (
  user_id = auth.uid()
);

-- 2. template_exercises: owner-only UPDATE and DELETE (following parent routine_template owner)
DROP POLICY IF EXISTS "Template exercises update policy" ON public.template_exercises;
CREATE POLICY "Template exercises update policy" ON public.template_exercises FOR UPDATE TO authenticated USING (
  EXISTS (
    SELECT 1 FROM public.routine_templates t
    WHERE t.id = template_exercises.template_id
      AND t.user_id = auth.uid()
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.routine_templates t
    WHERE t.id = template_exercises.template_id
      AND t.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Template exercises delete policy" ON public.template_exercises;
CREATE POLICY "Template exercises delete policy" ON public.template_exercises FOR DELETE TO authenticated USING (
  EXISTS (
    SELECT 1 FROM public.routine_templates t
    WHERE t.id = template_exercises.template_id
      AND t.user_id = auth.uid()
  )
);
