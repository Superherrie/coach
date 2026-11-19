-- Coach memory: lasting decisions, facts and preferences from chat (saved by the coach) or added by the athlete.
-- Every review and chat reads the active ones; the athlete can edit or delete them in Settings.
create table if not exists tr_coach_memory (
  id bigserial primary key,
  user_id uuid not null default coalesce(auth.uid(), tr_owner()),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  text text not null,
  kind text not null default 'decision' check (kind in ('decision','fact','preference','constraint')),
  expires_on date,                 -- null = until removed
  source text not null default 'chat' check (source in ('chat','athlete','review')),
  active boolean not null default true
);
create index if not exists tr_coach_memory_user on tr_coach_memory (user_id, active);
alter table tr_coach_memory enable row level security;
drop policy if exists tr_coach_memory_own on tr_coach_memory;
create policy tr_coach_memory_own on tr_coach_memory for all using (tr_is_member() and user_id = auth.uid()) with check (tr_is_member() and user_id = auth.uid());

-- what the coach saved/retired with a chat reply, shown under it in the app
alter table tr_chat add column if not exists meta jsonb;
