-- users table
create table public.users (
  id uuid references auth.users on delete cascade not null primary key,
  email text,
  username text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- exercises
create table public.exercises (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  body_part text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- workouts
create table public.workouts (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.users(id) on delete cascade not null,
  name text,
  date timestamp with time zone default timezone('utc'::text, now()) not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- sets
create table public.sets (
  id uuid default gen_random_uuid() primary key,
  workout_id uuid references public.workouts(id) on delete cascade not null,
  exercise_id uuid references public.exercises(id) on delete restrict not null,
  reps int not null,
  weight numeric not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- nutrition_logs
create table public.nutrition_logs (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.users(id) on delete cascade not null,
  food_name text not null,
  calories numeric not null,
  protein numeric,
  carbs numeric,
  fat numeric,
  "healthConnectRecordId" text,
  logged_at timestamp with time zone default timezone('utc'::text, now()) not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- custom_dishes
create table public.custom_dishes (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.users(id) on delete cascade not null,
  name text not null,
  ingredients text,
  calories numeric,
  protein numeric,
  carbs numeric,
  fat numeric,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);
