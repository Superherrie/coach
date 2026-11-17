-- Multi-user: every athlete's data is separate. Each data table gets user_id; RLS shows a member only their own rows.
-- Existing rows belong to the owner (Herman). Inserts default to the signed-in user; scripts and edge functions running
-- with the service role fall back to the owner unless they pass user_id explicitly.
-- The workout library (tr_workouts) stays shared: everyone reads it, only the owner edits it.

create or replace function tr_owner() returns uuid language sql stable security definer set search_path = public as
$$ select user_id from tr_members where role = 'owner' order by user_id limit 1 $$;
create or replace function tr_is_owner() returns boolean language sql stable security definer set search_path = public as
$$ select exists(select 1 from tr_members where user_id = auth.uid() and role = 'owner') $$;

alter table tr_members add column if not exists email text;
alter table tr_members add column if not exists must_change_pw boolean not null default false;
alter table tr_members add column if not exists created_at timestamptz default now();
update tr_members m set email = u.email from auth.users u where u.id = m.user_id and m.email is null;

-- user_id on every per-athlete table
do $$ declare t text; begin
  foreach t in array array['tr_settings','tr_phases','tr_events','tr_planned','tr_activities','tr_gym_sets','tr_wellness',
    'tr_coach_runs','tr_proposals','tr_chat','tr_sync_log','tr_meals','tr_meal_favs','tr_body_photos','tr_workout_log','tr_secrets'] loop
    execute format('alter table %I add column if not exists user_id uuid', t);
    execute format('update %I set user_id = tr_owner() where user_id is null', t);
    execute format('alter table %I alter column user_id set default coalesce(auth.uid(), tr_owner())', t);
    execute format('alter table %I alter column user_id set not null', t);
    execute format('create index if not exists %I on %I(user_id)', t || '_user', t);
  end loop;
end $$;

-- keys that were global become per user
alter table tr_settings drop constraint if exists tr_settings_id_check;
alter table tr_settings drop constraint if exists tr_settings_pkey;
alter table tr_settings alter column id drop default;
alter table tr_settings alter column id drop not null;
alter table tr_settings add primary key (user_id);

alter table tr_planned drop constraint if exists tr_planned_date_slot_key;
alter table tr_planned drop constraint if exists tr_planned_user_date_slot;
alter table tr_planned add constraint tr_planned_user_date_slot unique (user_id, date, slot);

alter table tr_wellness drop constraint if exists tr_wellness_pkey;
alter table tr_wellness add primary key (user_id, date);

alter table tr_secrets drop constraint if exists tr_secrets_pkey;
alter table tr_secrets add primary key (user_id, name);

-- RLS: own rows only
do $$ declare t text; begin
  foreach t in array array['tr_settings','tr_phases','tr_events','tr_planned','tr_activities','tr_gym_sets','tr_wellness',
    'tr_coach_runs','tr_proposals','tr_chat','tr_sync_log','tr_meals','tr_meal_favs','tr_body_photos','tr_workout_log'] loop
    execute format('drop policy if exists %I on %I', t || '_member', t);
    execute format('drop policy if exists %I on %I', t || '_own', t);
    execute format('create policy %I on %I for all using (tr_is_member() and user_id = auth.uid()) with check (tr_is_member() and user_id = auth.uid())', t || '_own', t);
  end loop;
end $$;
-- members see the member list (names) but only the owner changes it (through the tr-admin-users function)
drop policy if exists tr_members_member on tr_members;
drop policy if exists tr_members_read on tr_members;
drop policy if exists tr_members_self on tr_members;
create policy tr_members_read on tr_members for select using (tr_is_member() and (user_id = auth.uid() or tr_is_owner()));
create policy tr_members_self on tr_members for update using (user_id = auth.uid()) with check (user_id = auth.uid());
-- shared library
drop policy if exists tr_workouts_member on tr_workouts;
drop policy if exists tr_workouts_read on tr_workouts;
drop policy if exists tr_workouts_write on tr_workouts;
create policy tr_workouts_read on tr_workouts for select using (tr_is_member());
create policy tr_workouts_write on tr_workouts for all using (tr_is_owner()) with check (tr_is_owner());

-- RPCs scoped to the caller
create or replace function tr_set_icu(p_athlete text, p_key text) returns void language plpgsql security definer set search_path = public as $$
begin
  if not tr_is_member() then raise exception 'not a member'; end if;
  insert into tr_settings (user_id) values (auth.uid()) on conflict (user_id) do nothing;
  update tr_settings set icu_athlete_id = nullif(trim(p_athlete), ''), icu_connected_at = now(), updated_at = now() where user_id = auth.uid();
  if coalesce(trim(p_key), '') <> '' then
    insert into tr_secrets(user_id, name, value) values (auth.uid(), 'icu_api_key', trim(p_key))
      on conflict (user_id, name) do update set value = excluded.value, updated_at = now();
  end if;
end $$;
create or replace function tr_icu_key_set() returns boolean language sql stable security definer set search_path = public as
$$ select tr_is_member() and exists(select 1 from tr_secrets where user_id = auth.uid() and name = 'icu_api_key') $$;
create or replace function tr_set_admin_key(p_key text) returns void language plpgsql security definer set search_path = public as $$
begin
  if not tr_is_owner() then raise exception 'owner only'; end if;
  if coalesce(trim(p_key), '') = '' then delete from tr_secrets where user_id = auth.uid() and name = 'anthropic_admin_key';
  else insert into tr_secrets(user_id, name, value) values (auth.uid(), 'anthropic_admin_key', trim(p_key))
    on conflict (user_id, name) do update set value = excluded.value, updated_at = now(); end if;
end $$;
create or replace function tr_admin_key_set() returns boolean language sql stable security definer set search_path = public as
$$ select tr_is_owner() and exists(select 1 from tr_secrets where user_id = auth.uid() and name = 'anthropic_admin_key') $$;

create or replace function tr_decide_proposal(p_id bigint, p_accept boolean) returns void language plpgsql security definer set search_path = public as $$
declare pr tr_proposals; c jsonb; a jsonb;
begin
  if not tr_is_member() then raise exception 'not a member'; end if;
  select * into pr from tr_proposals where id = p_id and user_id = auth.uid() for update;
  if pr.id is null then raise exception 'not found'; end if;
  if pr.status <> 'pending' then raise exception 'already decided'; end if;
  if p_accept then
    for c in select * from jsonb_array_elements(pr.changes) loop
      a := c->'after';
      if a is null or a = 'null'::jsonb then
        delete from tr_planned where user_id = pr.user_id and date = (c->>'date')::date and slot = c->>'slot' and not locked;
      else
        insert into tr_planned (user_id, date, slot, sport, title, description, duration_min, distance_km, intensity, targets, planned_load, source, change_note, status)
        values (pr.user_id, (c->>'date')::date, c->>'slot', a->>'sport', a->>'title', a->>'description', (a->>'duration_min')::int, (a->>'distance_km')::numeric,
                a->>'intensity', coalesce(a->'targets', '{}'::jsonb), (a->>'planned_load')::int, 'coach', coalesce(a->>'change_note', pr.title), 'planned')
        on conflict (user_id, date, slot) do update set sport = excluded.sport, title = excluded.title, description = excluded.description,
          duration_min = excluded.duration_min, distance_km = excluded.distance_km, intensity = excluded.intensity, targets = excluded.targets,
          planned_load = excluded.planned_load, source = 'coach', change_note = excluded.change_note, status = 'planned', updated_at = now()
        where not tr_planned.locked;
      end if;
    end loop;
  end if;
  update tr_proposals set status = case when p_accept then 'accepted' else 'rejected' end, decided_at = now() where id = p_id;
end $$;

create or replace function tr_dedupe_strava(p_user uuid default null) returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update tr_activities i set planned_id = coalesce(i.planned_id, s.planned_id), rpe = coalesce(i.rpe, s.rpe), notes = coalesce(i.notes, s.notes), strava_id = s.id
  from tr_activities s
  where s.source = 'strava' and i.source = 'icu' and s.user_id = i.user_id and (p_user is null or i.user_id = p_user) and s.date = i.date
    and abs(extract(epoch from (s.start_local - i.start_local))) <= 900
    and (s.sport = i.sport or (s.sport like 'gym%' and i.sport like 'gym%'));
  delete from tr_activities s using tr_activities i
  where s.source = 'strava' and i.source = 'icu' and i.strava_id = s.id and s.user_id = i.user_id;
  get diagnostics n = row_count;
  return n;
end $$;

-- progress photos: each user's files live under their own folder <user_id>/...
update storage.objects set name = (select tr_owner())::text || '/' || name
  where bucket_id = 'tr-body' and name not like '________-____-____-____-____________/%';
update tr_body_photos set
  front_path = case when front_path is null or front_path like user_id::text || '/%' then front_path else user_id::text || '/' || front_path end,
  side_path  = case when side_path  is null or side_path  like user_id::text || '/%' then side_path  else user_id::text || '/' || side_path end,
  back_path  = case when back_path  is null or back_path  like user_id::text || '/%' then back_path  else user_id::text || '/' || back_path end;
drop policy if exists tr_body_read on storage.objects;
drop policy if exists tr_body_write on storage.objects;
drop policy if exists tr_body_delete on storage.objects;
create policy tr_body_read on storage.objects for select using (bucket_id = 'tr-body' and tr_is_member() and (storage.foldername(name))[1] = auth.uid()::text);
create policy tr_body_write on storage.objects for insert with check (bucket_id = 'tr-body' and tr_is_member() and (storage.foldername(name))[1] = auth.uid()::text);
create policy tr_body_delete on storage.objects for delete using (bucket_id = 'tr-body' and tr_is_member() and (storage.foldername(name))[1] = auth.uid()::text);
