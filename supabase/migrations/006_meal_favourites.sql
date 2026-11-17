-- Favourite dishes and drinks: saved copies of a meal's items, picked again with one tap (portion can be scaled).
create table if not exists tr_meal_favs (
  id bigserial primary key,
  name text not null,
  meal text not null default 'snack',
  items jsonb not null default '[]'::jsonb,
  kcal int not null,
  protein_g numeric, carbs_g numeric, fat_g numeric,
  uses int not null default 0,
  last_used timestamptz,
  created_at timestamptz default now()
);
alter table tr_meal_favs enable row level security;
drop policy if exists tr_meal_favs_member on tr_meal_favs;
create policy tr_meal_favs_member on tr_meal_favs for all using (tr_is_member()) with check (tr_is_member());
