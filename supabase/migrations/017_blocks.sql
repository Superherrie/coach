-- Per-block detail for every Garmin session (laps / work + recovery intervals from intervals.icu) and extra session
-- metrics (HR recovery, variability, respiration, power:HR…). Filled by tr-sync; blocks_at = when it was fetched.
alter table tr_activities add column if not exists blocks jsonb;
alter table tr_activities add column if not exists extras jsonb;
alter table tr_activities add column if not exists blocks_at timestamptz;
