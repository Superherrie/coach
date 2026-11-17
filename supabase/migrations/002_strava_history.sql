-- History imported once from Strava through the Strava connector (Herman's request, 17 Nov 2026).
-- Rows carry source = 'strava'. When intervals.icu later delivers the same session from Garmin, the Garmin row wins:
-- tr_dedupe_strava() (called at the end of every tr-sync) moves any plan link and notes across, then drops the Strava copy.
alter table tr_activities drop constraint if exists tr_activities_source_check;
alter table tr_activities add constraint tr_activities_source_check check (source in ('icu','manual','strava'));
alter table tr_activities add column if not exists strava_id text;

create or replace function tr_dedupe_strava() returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  -- carry the plan link, RPE and notes over to the Garmin copy
  update tr_activities i set
    planned_id = coalesce(i.planned_id, s.planned_id),
    rpe = coalesce(i.rpe, s.rpe),
    notes = coalesce(i.notes, s.notes),
    strava_id = s.id
  from tr_activities s
  where s.source = 'strava' and i.source = 'icu' and s.date = i.date
    and abs(extract(epoch from (s.start_local - i.start_local))) <= 900
    and (s.sport = i.sport or (s.sport like 'gym%' and i.sport like 'gym%'));
  delete from tr_activities s using tr_activities i
  where s.source = 'strava' and i.source = 'icu' and i.strava_id = s.id;
  get diagnostics n = row_count;
  return n;
end $$;
