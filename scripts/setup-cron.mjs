// One-off: creates TR_CRON_TOKEN (function secret + Supabase Vault + scripts/.env) and schedules the
// 05:15 SAST sync → coach run with pg_cron. Re-running rotates the token and replaces the job.
//   node scripts/setup-cron.mjs
import { readFileSync, appendFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const envPath = join(here, '.env');
for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2];
}
const REF = 'pniqwvyscmxfxbhtsace';
const H = { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' };
const token = randomBytes(24).toString('hex');

let r = await fetch(`https://api.supabase.com/v1/projects/${REF}/secrets`, { method: 'POST', headers: H, body: JSON.stringify([{ name: 'TR_CRON_TOKEN', value: token }]) });
console.log('function secret', r.status, (await r.text()).slice(0, 120));

const base = `https://${REF}.supabase.co/functions/v1`;
const sql = `
do $v$ declare sid uuid; begin
  select id into sid from vault.decrypted_secrets where name = 'tr_cron_token';
  if sid is null then perform vault.create_secret('${token}', 'tr_cron_token');
  else perform vault.update_secret(sid, '${token}'); end if;
end $v$;
select cron.unschedule(jobid) from cron.job where jobname in ('tr-morning', 'tr-morning-coach');
-- 03:15 UTC = 05:15 SAST: pull Garmin data; 03:25 UTC: coach review (gives the sync time to finish)
select cron.schedule('tr-morning', '15 3 * * *', $$
  select net.http_post(url := '${base}/tr-sync', body := '{}'::jsonb, timeout_milliseconds := 60000,
    headers := jsonb_build_object('Content-Type','application/json','x-cron-token',(select decrypted_secret from vault.decrypted_secrets where name='tr_cron_token')));
$$);
select cron.schedule('tr-morning-coach', '25 3 * * *', $$
  select net.http_post(url := '${base}/tr-coach', body := '{"mode":"daily"}'::jsonb, timeout_milliseconds := 150000,
    headers := jsonb_build_object('Content-Type','application/json','x-cron-token',(select decrypted_secret from vault.decrypted_secrets where name='tr_cron_token')));
$$);
select jobname, schedule from cron.job where jobname like 'tr-%';`;
r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, { method: 'POST', headers: H, body: JSON.stringify({ query: sql }) });
console.log('cron', r.status, (await r.text()).slice(0, 300));

const env = readFileSync(envPath, 'utf8');
if (/TR_CRON_TOKEN=/.test(env)) writeFileSync(envPath, env.replace(/TR_CRON_TOKEN=.*/, `TR_CRON_TOKEN=${token}`));
else appendFileSync(envPath, `\nTR_CRON_TOKEN=${token}\n`);
console.log('scripts/.env updated');
