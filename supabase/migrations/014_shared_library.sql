-- Shared workout library: every member reads every workout and can add new ones; the creator (or the owner) edits/deletes.
alter table tr_workouts add column if not exists created_by uuid default auth.uid();
alter table tr_workouts add column if not exists created_at timestamptz default now();
update tr_workouts set created_by = tr_owner() where created_by is null;
alter table tr_workouts drop constraint if exists tr_workouts_category_check;
alter table tr_workouts add constraint tr_workouts_category_check check (category in ('mobility','strength','drills','core','recovery','run','ride','other'));

drop policy if exists tr_workouts_read on tr_workouts;
drop policy if exists tr_workouts_write on tr_workouts;
drop policy if exists tr_workouts_insert on tr_workouts;
drop policy if exists tr_workouts_edit on tr_workouts;
drop policy if exists tr_workouts_delete on tr_workouts;
create policy tr_workouts_read on tr_workouts for select using (tr_is_member());
create policy tr_workouts_insert on tr_workouts for insert with check (tr_is_member() and created_by = auth.uid());
create policy tr_workouts_edit on tr_workouts for update using (tr_is_member() and (created_by = auth.uid() or tr_is_owner())) with check (tr_is_member());
create policy tr_workouts_delete on tr_workouts for delete using (tr_is_member() and (created_by = auth.uid() or tr_is_owner()));

-- workout log keeps working if a workout is deleted (history stays)
