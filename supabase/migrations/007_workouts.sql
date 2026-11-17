-- Workout library: guided sessions (mobility, strength, drills) with cues, timings and verified demo videos.
-- Planned sessions point at one through tr_planned.targets->>'workout_id'.
create table if not exists tr_workouts (
  id text primary key,                     -- slug, e.g. 'hip-mobility-run'
  name text not null,
  category text not null check (category in ('mobility','strength','drills','core','recovery')),
  summary text,
  duration_min int,
  equipment text,
  when_to_use text,
  exercises jsonb not null default '[]'::jsonb,   -- [{key,name,sets,reps,seconds,per_side,rest_s,cues[],why,video_id,video_title,video_channel}]
  updated_at timestamptz default now()
);
alter table tr_workouts enable row level security;
drop policy if exists tr_workouts_member on tr_workouts;
create policy tr_workouts_member on tr_workouts for all using (tr_is_member()) with check (tr_is_member());

-- a log of guided sessions finished in the player
create table if not exists tr_workout_log (
  id bigserial primary key,
  workout_id text references tr_workouts on delete set null,
  date date not null,
  done_at timestamptz default now(),
  minutes int,
  notes text
);
alter table tr_workout_log enable row level security;
drop policy if exists tr_workout_log_member on tr_workout_log;
create policy tr_workout_log_member on tr_workout_log for all using (tr_is_member()) with check (tr_is_member());
