-- Calories in (meals read by Claude from a photo or a dictated description, reviewed by Herman) and out
-- (Garmin activity calories + resting burn from weight, height and age).
create table if not exists tr_meals (
  id bigserial primary key,
  date date not null,
  eaten_at time,
  meal text not null default 'snack' check (meal in ('breakfast','lunch','dinner','snack','drink')),
  description text not null,
  items jsonb not null default '[]'::jsonb,       -- [{name, portion, kcal, protein_g, carbs_g, fat_g}]
  kcal int not null,
  protein_g numeric, carbs_g numeric, fat_g numeric,
  source text not null default 'text' check (source in ('photo','text','manual')),
  confidence text,                                 -- high | medium | low (Claude's own)
  notes text,
  created_at timestamptz default now()
);
create index if not exists tr_meals_date on tr_meals(date);
alter table tr_meals enable row level security;
drop policy if exists tr_meals_member on tr_meals;
create policy tr_meals_member on tr_meals for all using (tr_is_member()) with check (tr_is_member());

alter table tr_activities add column if not exists calories int;

alter table tr_settings add column if not exists birth_year int default 1980;
alter table tr_settings add column if not exists activity_factor numeric default 1.25;  -- non-exercise day (desk job)
alter table tr_settings add column if not exists kcal_deficit int default 500;           -- daily target below "out"
