-- Top-5 improvements (18 Nov 2026): Garmin push via intervals.icu, running paces, session reports.
alter table tr_planned add column if not exists icu_event_id bigint;
alter table tr_planned add column if not exists icu_hash text;       -- what was last pushed (skip unchanged sessions)
alter table tr_planned add column if not exists icu_doc text;        -- the workout text in intervals.icu syntax
alter table tr_planned add column if not exists icu_pushed_at timestamptz;
alter table tr_planned add column if not exists icu_error text;

alter table tr_settings add column if not exists garmin_push boolean not null default false;
alter table tr_settings add column if not exists paces jsonb;          -- {vdot, source, date, easy:[s,s], marathon, threshold, interval, comrades_goal}
update tr_settings set garmin_push = true where user_id = tr_owner();

create table if not exists tr_session_reports (
  id bigserial primary key,
  user_id uuid not null default coalesce(auth.uid(), tr_owner()),
  activity_id text not null references tr_activities on delete cascade,
  created_at timestamptz default now(),
  report jsonb not null,               -- {headline, verdict, numbers:[{label,value}], points[], next}
  model text, usage jsonb,
  unique (activity_id)
);
alter table tr_session_reports enable row level security;
drop policy if exists tr_session_reports_own on tr_session_reports;
create policy tr_session_reports_own on tr_session_reports for all using (tr_is_member() and user_id = auth.uid()) with check (tr_is_member() and user_id = auth.uid());
