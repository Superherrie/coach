// Loads scripts/workouts/*.json into tr_workouts, adding the verified demo video for each exercise
// from scripts/data/exercise-videos.json (key â†’ video_id/title/channel; unverified ones are left without a video).
//   node scripts/seed-workouts.mjs
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const here = dirname(fileURLToPath(import.meta.url));
for (const line of readFileSync(join(here, '.env'), 'utf8').split(/\r?\n/)) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m) process.env[m[1]] ??= m[2]; }
const read = p => JSON.parse(readFileSync(p, 'utf8').replace(/^ï»¿/, ''));
const vidPath = join(here, 'workouts', 'exercise-videos.json');
const videos = new Map((existsSync(vidPath) ? read(vidPath) : []).filter(v => v.verified && v.video_id).map(v => [v.key, v]));

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
for (const f of readdirSync(join(here, 'workouts')).filter(f => f.endsWith('.json') && f !== 'exercise-videos.json')) {
  const w = read(join(here, 'workouts', f));
  w.exercises = w.exercises.map(e => { const v = videos.get(e.key); return { ...e, video_id: v?.video_id ?? null, video_title: v?.title ?? null, video_channel: v?.channel ?? null } });
  const { error } = await db.from('tr_workouts').upsert({ ...w, updated_at: new Date().toISOString() });
  if (error) throw error;
  console.log(`${w.id}: ${w.exercises.length} exercises, ${w.exercises.filter(e => e.video_id).length} with video`);
}
