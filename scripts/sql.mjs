// Runs a read/write SQL file against the shared Supabase project (Management API, PAT only).
//   node scripts/sql.mjs path/to/query.sql
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
for (const line of readFileSync(join(here, '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2];
}
const sql = readFileSync(process.argv[2], 'utf8');
const res = await fetch('https://api.supabase.com/v1/projects/pniqwvyscmxfxbhtsace/database/query', {
  method: 'POST',
  headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: sql }),
});
const text = await res.text();
if (!res.ok) { console.error(`FAILED (HTTP ${res.status}):`, text); process.exit(1); }
console.log(text);
