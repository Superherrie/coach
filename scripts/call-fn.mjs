// Calls a tr- edge function with the schedule token (what the 05:15 cron does).
//   node scripts/call-fn.mjs tr-sync '{"days":30}'
//   node scripts/call-fn.mjs tr-coach '{"mode":"daily"}'
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
for (const line of readFileSync(join(here, '.env'), 'utf8').split(/\r?\n/)) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m) process.env[m[1]] ??= m[2]; }
const [name, arg = '{}'] = process.argv.slice(2);
// the body may be a JSON string or a path to a .json file (PowerShell mangles quotes in arguments)
const body = arg.trim().startsWith('{') ? arg : readFileSync(arg, 'utf8');
const t0 = Date.now();
const r = await fetch(`https://pniqwvyscmxfxbhtsace.supabase.co/functions/v1/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-cron-token': process.env.TR_CRON_TOKEN }, body });
console.log(r.status, `${((Date.now() - t0) / 1000).toFixed(1)} s`);
console.log(JSON.stringify(await r.json(), null, 2));
