-- Body composition: neck measurement for the US Navy body-fat estimate, and monthly progress photos
-- (private storage bucket, members only) that Claude compares set to set.
alter table tr_wellness add column if not exists neck_cm numeric;

create table if not exists tr_body_photos (
  id bigserial primary key,
  date date not null,
  front_path text, side_path text, back_path text,     -- paths in the private 'tr-body' bucket
  weight_kg numeric, waist_cm numeric, neck_cm numeric, navy_bf numeric,
  ai jsonb,                                            -- {bf_low, bf_high, bf_best, confidence, changes[], notes, compared_to}
  notes text,
  created_at timestamptz default now()
);
alter table tr_body_photos enable row level security;
drop policy if exists tr_body_photos_member on tr_body_photos;
create policy tr_body_photos_member on tr_body_photos for all using (tr_is_member()) with check (tr_is_member());

-- private bucket: not public, files reachable only by members (signed URLs) and the service role
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tr-body', 'tr-body', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false;

drop policy if exists tr_body_read on storage.objects;
drop policy if exists tr_body_write on storage.objects;
drop policy if exists tr_body_delete on storage.objects;
create policy tr_body_read on storage.objects for select using (bucket_id = 'tr-body' and tr_is_member());
create policy tr_body_write on storage.objects for insert with check (bucket_id = 'tr-body' and tr_is_member());
create policy tr_body_delete on storage.objects for delete using (bucket_id = 'tr-body' and tr_is_member());
