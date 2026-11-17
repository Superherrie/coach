-- Garmin push 05:40 and 18:40 SAST (after the morning review, and after any proposals accepted during the day);
-- weekly review Sundays 18:00 SAST. Same Vault token as the other tr- jobs.
select cron.unschedule(jobid) from cron.job where jobname in ('tr-garmin-am', 'tr-garmin-pm', 'tr-weekly');
select cron.schedule('tr-garmin-am', '40 3 * * *', $$
  select net.http_post(url := 'https://pniqwvyscmxfxbhtsace.supabase.co/functions/v1/tr-garmin', body := '{}'::jsonb, timeout_milliseconds := 120000,
    headers := jsonb_build_object('Content-Type','application/json','x-cron-token',(select decrypted_secret from vault.decrypted_secrets where name='tr_cron_token')));
$$);
select cron.schedule('tr-garmin-pm', '40 16 * * *', $$
  select net.http_post(url := 'https://pniqwvyscmxfxbhtsace.supabase.co/functions/v1/tr-garmin', body := '{}'::jsonb, timeout_milliseconds := 120000,
    headers := jsonb_build_object('Content-Type','application/json','x-cron-token',(select decrypted_secret from vault.decrypted_secrets where name='tr_cron_token')));
$$);
select cron.schedule('tr-weekly', '0 16 * * 0', $$
  select net.http_post(url := 'https://pniqwvyscmxfxbhtsace.supabase.co/functions/v1/tr-coach', body := '{"mode":"weekly"}'::jsonb, timeout_milliseconds := 150000,
    headers := jsonb_build_object('Content-Type','application/json','x-cron-token',(select decrypted_secret from vault.decrypted_secrets where name='tr_cron_token')));
$$);
