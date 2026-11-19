-- Today's fuel targets set by the coach in its daily review (kcal, carbs, protein, fat + one-line why).
alter table tr_coach_runs add column if not exists fuel jsonb;
