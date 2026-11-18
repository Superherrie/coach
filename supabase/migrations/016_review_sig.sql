-- Fingerprint of the data a daily review was based on, so the app can ask for a fresh review on refresh
-- and the function skips Claude when nothing has changed.
alter table tr_coach_runs add column if not exists input_sig text;
