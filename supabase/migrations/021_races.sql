-- Races: one row per race the athlete rode or ran (past editions too), with result, goal, PB going in and course notes.
-- The session report and every coach run read these, so a race is judged as a race (result first, course and past
-- editions in view) and not as a training session.
create table if not exists tr_races (
  id bigserial primary key,
  user_id uuid not null default coalesce(auth.uid(), tr_owner()),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  date date not null,
  event text not null,                 -- same text across years, e.g. '947 Ride Joburg', so editions can be compared
  sport text not null default 'ride',
  distance_km numeric,
  elev_m numeric,
  goal_s int,                          -- goal time, seconds
  time_s int,                          -- official / finish time, seconds (null until known)
  time_note text,                      -- e.g. 'Garmin moving time; official time not yet confirmed'
  pb_before_s int,                     -- PB going into this race
  avg_watts numeric, avg_hr numeric,
  course_notes text,                   -- start/finish, where the climbing sits, what changed from last year
  sections jsonb,                      -- [{name, km, climb_m, position, time_s, watts, hr, kmh}] like-for-like course sections
  activity_id text,                    -- tr_activities.id when the file is in the app
  notes text
);
create unique index if not exists tr_races_user_event_date on tr_races (user_id, event, date);
alter table tr_races enable row level security;
drop policy if exists tr_races_own on tr_races;
create policy tr_races_own on tr_races for all using (tr_is_member() and user_id = auth.uid()) with check (tr_is_member() and user_id = auth.uid());
