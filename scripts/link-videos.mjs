// Links verified demo videos into a library workout (matched on exercise key, or on name if keys differ).
//   node scripts/link-videos.mjs <workout id> <videos.json>
// videos.json: [{ key, name, video_id, title, channel, verified }] — only verified entries with an id are used;
// exercises that already have a video keep it unless the file has a verified one for them.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const here = dirname(fileURLToPath(import.meta.url));
for (const line of readFileSync(join(here, '.env'), 'utf8').split(/\r?\n/)) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m) process.env[m[1]] ??= m[2]; }
const [id, file] = process.argv.slice(2);
if (!id || !file) { console.error('usage: node scripts/link-videos.mjs <workout id> <videos.json>'); process.exit(1); }
const vids = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, '')).filter(v => v.verified && v.video_id);
const norm = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: w, error } = await db.from('tr_workouts').select('id,name,exercises').eq('id', id).single();
if (error) throw error;
let n = 0;
const exercises = w.exercises.map(e => {
  const v = vids.find(v => v.key === e.key) ?? vids.find(v => norm(v.name) === norm(e.name));
  if (!v) return e;
  n++; return { ...e, video_id: v.video_id, video_title: v.title, video_channel: v.channel };
});
const r = await db.from('tr_workouts').update({ exercises, updated_at: new Date().toISOString() }).eq('id', id);
if (r.error) throw r.error;
console.log(`${w.name}: ${n} of ${w.exercises.length} exercises linked`);
for (const e of exercises) console.log(' ', e.video_id ? '✓' : '–', e.name, e.video_id ? `→ ${e.video_title} (${e.video_channel})` : '(no video)');
