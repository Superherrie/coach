-- InBody scans: numbers read by Claude from a screenshot/photo of the result sheet, checked by the athlete before saving.
-- The image stays in the private 'tr-body' bucket under the user's own folder (<uid>/inbody/...).
create table if not exists tr_inbody (
  id bigserial primary key,
  user_id uuid not null default coalesce(auth.uid(), tr_owner()),
  date date not null,
  image_path text,
  weight_kg numeric,
  smm_kg numeric,          -- skeletal muscle mass
  bfm_kg numeric,          -- body fat mass
  pbf numeric,             -- percent body fat
  ffm_kg numeric,          -- fat-free mass
  tbw_l numeric,           -- total body water
  ecw_ratio numeric,       -- ECW/TBW
  visceral_level numeric,
  bmr_kcal numeric,
  inbody_score numeric,
  segments jsonb,          -- {lean:{right_arm,left_arm,trunk,right_leg,left_leg}, fat:{...}} kg
  model text,              -- e.g. InBody 570 / 770
  notes text,
  created_at timestamptz default now()
);
create index if not exists tr_inbody_user_date on tr_inbody (user_id, date);
alter table tr_inbody enable row level security;
drop policy if exists tr_inbody_own on tr_inbody;
create policy tr_inbody_own on tr_inbody for all using (tr_is_member() and user_id = auth.uid()) with check (tr_is_member() and user_id = auth.uid());
