-- Coach — Herman's training app (Comrades 2027). Shared Supabase project; every table is prefixed tr_.
-- Re-runnable: tables use IF NOT EXISTS, functions/policies are replaced.

-- ---------- membership (the project also holds work and other-app logins) ----------
create table if not exists tr_members (
  user_id uuid primary key references auth.users on delete cascade,
  display_name text not null,
  role text not null default 'owner'
);
create or replace function tr_is_member() returns boolean language sql stable security definer set search_path = public as
$$ select exists(select 1 from tr_members where user_id = auth.uid()) $$;
insert into tr_members (user_id, display_name, role)
  select user_id, display_name, 'owner' from pf_members where role = 'owner' on conflict do nothing;

-- ---------- settings / profile (one row) ----------
create table if not exists tr_settings (
  id int primary key default 1 check (id = 1),
  icu_athlete_id text,                 -- intervals.icu athlete id, e.g. i123456 (0 = the key's own athlete)
  icu_connected_at timestamptz,
  height_cm numeric,                   -- for waist-to-height ratio; Herman fills it in Settings
  ftp_w int default 310,
  max_hr int default 185,
  run_max_hr int,                      -- running max HR, once known
  easy_run_hr_cap int default 140,     -- conversational ceiling until the 10 km TT sets paces
  goal_weight_kg numeric default 91,
  coach_auto boolean default true,     -- small changes apply automatically
  coach_model text default 'claude-opus-5-5',
  notes text,
  updated_at timestamptz default now()
);
insert into tr_settings (id) values (1) on conflict do nothing;

-- the intervals.icu API key never leaves the database: write-only for the app, read by the sync function (service role)
create table if not exists tr_secrets (name text primary key, value text not null, updated_at timestamptz default now());
create or replace function tr_set_icu(p_athlete text, p_key text) returns void language plpgsql security definer set search_path = public as $$
begin
  if not tr_is_member() then raise exception 'not a member'; end if;
  update tr_settings set icu_athlete_id = nullif(trim(p_athlete), ''), icu_connected_at = now(), updated_at = now() where id = 1;
  if coalesce(trim(p_key), '') <> '' then
    insert into tr_secrets(name, value) values ('icu_api_key', trim(p_key))
      on conflict (name) do update set value = excluded.value, updated_at = now();
  end if;
end $$;
create or replace function tr_icu_key_set() returns boolean language sql stable security definer set search_path = public as
$$ select tr_is_member() and exists(select 1 from tr_secrets where name = 'icu_api_key') $$;

-- ---------- plan structure ----------
create table if not exists tr_phases (
  id serial primary key,
  name text not null,
  start_date date not null,
  end_date date not null,
  focus text,
  run_km_from numeric, run_km_to numeric,       -- weekly ceiling ramps from → to across the phase
  long_run_from numeric, long_run_to numeric,
  leg_sessions text,
  key_sessions text,
  strength_emphasis text
);

create table if not exists tr_events (
  id serial primary key,
  date date not null,
  name text not null,
  kind text not null default 'race' check (kind in ('race','checkpoint','travel','test')),
  distance_km numeric,
  purpose text,
  target text,
  on_track text, borderline text, rethink text,
  result text,
  entry_status text
);

-- ---------- planned sessions: two slots a day ----------
create table if not exists tr_planned (
  id bigserial primary key,
  date date not null,
  slot text not null check (slot in ('am','pm')),
  sport text not null check (sport in ('run','ride','gym_legs','gym_upper','mobility','rest','race')),
  title text not null,
  description text,
  duration_min int,
  distance_km numeric,
  intensity text check (intensity in ('rest','recovery','easy','moderate','hard','race')),
  targets jsonb not null default '{}'::jsonb,      -- {hr_max, pace, watts, blocks:[...], exercises:[{name,sets,reps,kg}]}
  planned_load int,
  source text not null default 'seed' check (source in ('seed','coach','manual')),
  change_note text,                                -- why it was changed (shown on the card)
  locked boolean not null default false,           -- the coach may not touch it
  status text not null default 'planned' check (status in ('planned','done','skipped')),
  updated_at timestamptz default now(),
  unique (date, slot)
);
create index if not exists tr_planned_date on tr_planned(date);

-- ---------- actual sessions (intervals.icu / manual) ----------
create table if not exists tr_activities (
  id text primary key,                 -- intervals.icu id, or 'm-<uuid>' for manual
  source text not null check (source in ('icu','manual')),
  date date not null,
  start_local timestamp,
  slot text check (slot in ('am','pm')),
  sport text not null,                 -- run | ride | gym_legs | gym_upper | mobility | other
  icu_type text,
  name text,
  trainer boolean,
  duration_s int, distance_m numeric, elev_m numeric,
  avg_hr int, max_hr int,
  avg_watts int, np_watts int, ftp int,
  avg_pace_s numeric,                  -- seconds per km (runs)
  gap_pace_s numeric,                  -- grade-adjusted
  load int,                            -- intervals.icu training load (TSS-like) or estimated from RPE
  intensity numeric,                   -- intensity factor (%), icu
  ef numeric,                          -- efficiency factor
  decoupling numeric,                  -- aerobic decoupling %
  rpe int, feel int,
  hr_zone_s int[],                     -- seconds in HR zones
  notes text,
  planned_id bigint references tr_planned on delete set null,
  raw jsonb,
  updated_at timestamptz default now()
);
create index if not exists tr_activities_date on tr_activities(date);

create table if not exists tr_gym_sets (
  id bigserial primary key,
  activity_id text not null references tr_activities on delete cascade,
  date date not null,
  exercise text not null,
  set_no int not null,
  reps int,
  kg numeric,
  rir int,                              -- reps in reserve
  created_at timestamptz default now()
);
create index if not exists tr_gym_sets_ex on tr_gym_sets(exercise, date);

-- ---------- daily wellness: watch data from intervals.icu + Herman's check-in ----------
create table if not exists tr_wellness (
  date date primary key,
  resting_hr int, hrv numeric, sleep_h numeric, sleep_score numeric,
  weight_kg numeric, waist_cm numeric, body_fat numeric,
  icu_ctl numeric, icu_atl numeric, icu_ramp numeric,
  legs int,          -- 1 fresh … 5 very sore (check-in)
  energy int,        -- 1 flat … 5 great
  ankle_pain int,    -- 0–10 (plan rule: >3 means back off a week)
  motivation int,
  notes text,
  manual jsonb not null default '{}'::jsonb,   -- which fields Herman typed (sync never overwrites those)
  updated_at timestamptz default now()
);

-- ---------- coach ----------
create table if not exists tr_coach_runs (
  id bigserial primary key,
  created_at timestamptz default now(),
  kind text not null,                 -- daily | chat | weekly
  summary text,
  today_note text,
  model text, usage jsonb, error text
);
create table if not exists tr_proposals (
  id bigserial primary key,
  created_at timestamptz default now(),
  run_id bigint references tr_coach_runs on delete set null,
  title text not null,
  why text,
  changes jsonb not null,             -- [{date, slot, before:{...}|null, after:{...}}]
  status text not null default 'pending' check (status in ('pending','accepted','rejected','applied','expired')),
  decided_at timestamptz
);
create table if not exists tr_chat (
  id bigserial primary key,
  created_at timestamptz default now(),
  role text not null check (role in ('user','assistant')),
  content text not null
);
create table if not exists tr_sync_log (
  id bigserial primary key,
  created_at timestamptz default now(),
  kind text, ok boolean, detail jsonb
);

-- ---------- RLS: members only ----------
do $$ declare t text; begin
  foreach t in array array['tr_members','tr_settings','tr_phases','tr_events','tr_planned','tr_activities','tr_gym_sets','tr_wellness','tr_coach_runs','tr_proposals','tr_chat','tr_sync_log'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_member', t);
    execute format('create policy %I on %I for all using (tr_is_member()) with check (tr_is_member())', t || '_member', t);
  end loop;
end $$;
alter table tr_secrets enable row level security;   -- no policy: invisible to app users

-- ---------- accept / reject a coach proposal ----------
create or replace function tr_decide_proposal(p_id bigint, p_accept boolean) returns void language plpgsql security definer set search_path = public as $$
declare pr tr_proposals; c jsonb; a jsonb;
begin
  if not tr_is_member() then raise exception 'not a member'; end if;
  select * into pr from tr_proposals where id = p_id for update;
  if pr.status <> 'pending' then raise exception 'already decided'; end if;
  if p_accept then
    for c in select * from jsonb_array_elements(pr.changes) loop
      a := c->'after';
      if a is null or a = 'null'::jsonb then
        delete from tr_planned where date = (c->>'date')::date and slot = c->>'slot' and not locked;
      else
        insert into tr_planned (date, slot, sport, title, description, duration_min, distance_km, intensity, targets, planned_load, source, change_note, status)
        values ((c->>'date')::date, c->>'slot', a->>'sport', a->>'title', a->>'description', (a->>'duration_min')::int, (a->>'distance_km')::numeric,
                a->>'intensity', coalesce(a->'targets', '{}'::jsonb), (a->>'planned_load')::int, 'coach', coalesce(a->>'change_note', pr.title), 'planned')
        on conflict (date, slot) do update set sport = excluded.sport, title = excluded.title, description = excluded.description,
          duration_min = excluded.duration_min, distance_km = excluded.distance_km, intensity = excluded.intensity, targets = excluded.targets,
          planned_load = excluded.planned_load, source = 'coach', change_note = excluded.change_note, status = 'planned', updated_at = now()
        where not tr_planned.locked;
      end if;
    end loop;
  end if;
  update tr_proposals set status = case when p_accept then 'accepted' else 'rejected' end, decided_at = now() where id = p_id;
end $$;

-- ---------- scheduling: sync + daily coach at 05:15 SAST (03:15 UTC) ----------
create extension if not exists pg_cron;
create extension if not exists pg_net;
