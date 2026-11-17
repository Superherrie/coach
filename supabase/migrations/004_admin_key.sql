-- Anthropic Admin API key for account-wide spend (Usage & Cost API). Write-only for the app, like the intervals.icu key:
-- stored in tr_secrets (no RLS policy), read only by the tr-api-cost function with the service role.
create or replace function tr_set_admin_key(p_key text) returns void language plpgsql security definer set search_path = public as $$
begin
  if not tr_is_member() then raise exception 'not a member'; end if;
  if coalesce(trim(p_key), '') = '' then
    delete from tr_secrets where name = 'anthropic_admin_key';
  else
    insert into tr_secrets(name, value) values ('anthropic_admin_key', trim(p_key))
      on conflict (name) do update set value = excluded.value, updated_at = now();
  end if;
end $$;
create or replace function tr_admin_key_set() returns boolean language sql stable security definer set search_path = public as
$$ select tr_is_member() and exists(select 1 from tr_secrets where name = 'anthropic_admin_key') $$;
