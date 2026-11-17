-- Members must not edit their own tr_members row (it holds the role). Clearing the "change your temporary password"
-- flag goes through this function, which can do nothing else.
drop policy if exists tr_members_self on tr_members;
create or replace function tr_password_changed() returns void language sql security definer set search_path = public as
$$ update tr_members set must_change_pw = false where user_id = auth.uid() $$;
