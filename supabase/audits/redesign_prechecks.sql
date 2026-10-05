-- Redesign read-only prechecks (RD-15, RD-16, P1/W50 audit). Run: scripts/prod-db.sh audit supabase/audits/redesign_prechecks.sql
-- Pure SELECT; changes nothing.
WITH utz AS (
  SELECT u.id AS user_id,
         CASE WHEN u.timezone IS NOT NULL AND EXISTS (SELECT 1 FROM pg_timezone_names tz WHERE tz.name = u.timezone)
              THEN u.timezone ELSE 'UTC' END AS tz
  FROM public.users u
),
day_utc AS (
  SELECT w.user_id, (w.date AT TIME ZONE 'UTC')::date AS d, count(*) AS n
  FROM public.workouts w GROUP BY 1, 2
),
day_local AS (
  -- RD-5 civil date: midnight-UTC rows keep their UTC date; rows with a time use the user's zone.
  SELECT w.user_id,
         CASE WHEN (w.date AT TIME ZONE 'UTC')::time = '00:00:00' THEN (w.date AT TIME ZONE 'UTC')::date
              ELSE (w.date AT TIME ZONE coalesce(utz.tz, 'UTC'))::date END AS d,
         count(*) AS n
  FROM public.workouts w LEFT JOIN utz ON utz.user_id = w.user_id GROUP BY 1, 2
),
linked AS (
  SELECT coach_id, athlete_id FROM public.coach_athlete_links WHERE status = 'active'
),
unlinked_sets AS (
  SELECT s.id, w.user_id AS owner, e.id AS ex
  FROM public.sets s
  JOIN public.workouts w ON w.id = s.workout_id
  JOIN public.exercises e ON e.id = s.exercise_id
  WHERE e.is_master = false
    AND w.user_id IS DISTINCT FROM e.user_id
    AND NOT EXISTS (SELECT 1 FROM linked l
                    WHERE (l.coach_id = w.user_id AND l.athlete_id = e.user_id)
                       OR (l.athlete_id = w.user_id AND l.coach_id = e.user_id))
),
cross_templates AS (
  SELECT te.id, t.id AS template_id,
         EXISTS (SELECT 1 FROM linked l
                 WHERE (l.coach_id = t.user_id AND l.athlete_id = e.user_id)
                    OR (l.athlete_id = t.user_id AND l.coach_id = e.user_id)) AS is_linked
  FROM public.template_exercises te
  JOIN public.routine_templates t ON t.id = te.template_id
  JOIN public.exercises e ON e.id = te.exercise_id
  WHERE e.is_master = false AND t.user_id IS DISTINCT FROM e.user_id
)
SELECT 1 AS ord, 'RD-15 duplicate workout days (UTC date)' AS metric, count(*)::text AS value FROM day_utc WHERE n > 1
UNION ALL SELECT 2, 'RD-15 duplicate workout days (RD-5 civil date)', count(*)::text FROM day_local WHERE n > 1
UNION ALL SELECT 3, 'RD-15 users affected (RD-5 civil date)', count(DISTINCT user_id)::text FROM day_local WHERE n > 1
UNION ALL SELECT 4, 'RD-16 warm-up sets', count(*)::text FROM public.sets WHERE set_type = 'warmup'
UNION ALL SELECT 5, 'RD-16 drop sets', count(*)::text FROM public.sets WHERE set_type = 'drop'
UNION ALL SELECT 6, 'RD-16 users with warm-up/drop sets', count(DISTINCT w.user_id)::text
          FROM public.sets s JOIN public.workouts w ON w.id = s.workout_id WHERE s.set_type IN ('warmup', 'drop')
UNION ALL SELECT 7, 'P1/W50a sets on unlinked non-master exercises', count(*)::text FROM unlinked_sets
UNION ALL SELECT 8, 'P1/W50a exercises involved', count(DISTINCT ex)::text FROM unlinked_sets
UNION ALL SELECT 9, 'P1/W50b template rows using another user''s non-master exercise', count(*)::text FROM cross_templates
UNION ALL SELECT 10, 'P1/W50b ... of which NOT linked (coach/athlete)', count(*)::text FROM cross_templates WHERE NOT is_linked
UNION ALL SELECT 11, 'P1 blank/whitespace exercise names', count(*)::text FROM public.exercises WHERE name IS NULL OR length(trim(name)) = 0
UNION ALL SELECT 12, 'context: total workouts', count(*)::text FROM public.workouts
UNION ALL SELECT 13, 'context: total sets', count(*)::text FROM public.sets
UNION ALL SELECT 14, 'context: total users', count(*)::text FROM public.users
ORDER BY ord;
