-- Hard "never" rules: coach-memory items the coach's output is checked against after every plan-writing run.
--   hard = true  → checked by Claude after each run (any wording works, no code change needed)
--   rule jsonb   → optional machine checks run in code: {"banned": [regex…], "carbs_max_gkg": {"easy": 5, "hard": 8}, "burn_from_app": true}
alter table tr_coach_memory add column if not exists hard boolean not null default false;
alter table tr_coach_memory add column if not exists rule jsonb;
-- what the check found on each run: {violations:[…], fixed:[…], flagged:[…]}
alter table tr_coach_runs add column if not exists guard jsonb;

-- Herman's existing "never" rules
update tr_coach_memory set hard = true, expires_on = null,
  rule = '{"carbs_max_gkg": {"easy": 5, "hard": 8}, "banned": ["carb(?:o|ohydrate)?s?[- ]?load", "load(?:ing)? up on carbs", "loading days?", "day-before-race fuelling", "super-?compensat"]}'
  where id = 8;
update tr_coach_memory set hard = true, expires_on = null,
  rule = '{"banned": ["\\bbeers?\\b", "\\balcohol", "castle lite", "\\bwine\\b", "\\bbooze\\b", "\\bdrinking\\b"]}'
  where id = 1;
insert into tr_coach_memory (user_id, text, kind, source, hard, rule)
select 'd734872f-2bf5-4b04-be9e-328cbf6b0306', 'Calorie burn always comes from the app''s own figure (energy_today); never estimate or re-calculate burn.', 'preference', 'athlete', true, '{"burn_from_app": true}'
where not exists (select 1 from tr_coach_memory where user_id = 'd734872f-2bf5-4b04-be9e-328cbf6b0306' and rule ? 'burn_from_app');
insert into tr_coach_memory (user_id, text, kind, source, hard)
select 'd734872f-2bf5-4b04-be9e-328cbf6b0306', 'No mobility workouts (e.g. hip mobility) unless Herman asks for them.', 'preference', 'athlete', true
where not exists (select 1 from tr_coach_memory where user_id = 'd734872f-2bf5-4b04-be9e-328cbf6b0306' and text like 'No mobility workouts%');
