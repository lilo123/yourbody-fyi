-- Enable RLS
alter table public.users enable row level security;
alter table public.exercises enable row level security;
alter table public.workouts enable row level security;
alter table public.sets enable row level security;
alter table public.nutrition_logs enable row level security;
alter table public.custom_dishes enable row level security;

-- Admin policies based on JWT Custom Claims
create policy "Admins can do anything on users" on public.users for all using ((nullif(current_setting('request.jwt.claims', true), '')::jsonb)->'app_metadata'->>'role' = 'admin');
create policy "Admins can do anything on exercises" on public.exercises for all using ((nullif(current_setting('request.jwt.claims', true), '')::jsonb)->'app_metadata'->>'role' = 'admin');
create policy "Admins can do anything on workouts" on public.workouts for all using ((nullif(current_setting('request.jwt.claims', true), '')::jsonb)->'app_metadata'->>'role' = 'admin');
create policy "Admins can do anything on sets" on public.sets for all using ((nullif(current_setting('request.jwt.claims', true), '')::jsonb)->'app_metadata'->>'role' = 'admin');
create policy "Admins can do anything on nutrition_logs" on public.nutrition_logs for all using ((nullif(current_setting('request.jwt.claims', true), '')::jsonb)->'app_metadata'->>'role' = 'admin');
create policy "Admins can do anything on custom_dishes" on public.custom_dishes for all using ((nullif(current_setting('request.jwt.claims', true), '')::jsonb)->'app_metadata'->>'role' = 'admin');

-- User policies
create policy "Users can manage their own user record" on public.users for all using (auth.uid() = id);
create policy "Anyone can read exercises" on public.exercises for select using (true);
create policy "Users can manage their own workouts" on public.workouts for all using (auth.uid() = user_id);
create policy "Users can manage sets for their workouts" on public.sets for all using (
  exists (select 1 from public.workouts where workouts.id = sets.workout_id and workouts.user_id = auth.uid())
);
create policy "Users can manage their own nutrition_logs" on public.nutrition_logs for all using (auth.uid() = user_id);
create policy "Users can manage their own custom_dishes" on public.custom_dishes for all using (auth.uid() = user_id);
