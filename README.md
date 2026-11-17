# Coach — road to Comrades 2027

Herman's personal training app: two sessions a day (morning / afternoon), what was actually done (Garmin via
intervals.icu, or logged by hand), a morning check-in, trends, and a Claude coach that adjusts the plan.

Live: https://superherrie.github.io/coach/ (push to `main` deploys).

## Stack
Vite + React + TypeScript + Tailwind v4 (HashRouter PWA) · shared Supabase project `pniqwvyscmxfxbhtsace`, tables `tr_*`
(RLS via `tr_is_member()`) · edge functions `tr-sync` (intervals.icu → tables) and `tr-coach` (Claude) · pg_cron:
`tr-morning` 03:15 UTC (sync) and `tr-morning-coach` 03:25 UTC (daily review), both calling with `TR_CRON_TOKEN` from Vault.

**Strava is deliberately not used**: its API policy (1 June 2026, s5.3) forbids passing Strava data to any AI.
Garmin data reaches the app through intervals.icu; sessions intervals.icu only has from Strava are skipped.

## Scripts (`scripts/.env` holds the Supabase PAT, service key and TR_CRON_TOKEN — git-ignored)
| | |
|---|---|
| `node scripts/apply-schema.mjs 001_init.sql` | apply a migration |
| `node scripts/deploy-functions.mjs tr-sync:public tr-coach:public` | deploy functions (they check membership / cron token themselves) |
| `node scripts/seed-plan.mjs [--apply]` | phases, races and the day-by-day plan from the Comrades doc; keeps coach/manual sessions |
| `node scripts/setup-cron.mjs` | (re)create TR_CRON_TOKEN and the two cron jobs |
| `node scripts/call-fn.mjs tr-coach '{"mode":"daily"}'` | run a function as the schedule does |
| `node scripts/sql.mjs file.sql` | ad-hoc SQL |

## Coach rules (enforced in `tr-coach`, not just prompted)
Small changes (within 7 days, not a long run ≥ 25 km / 150 min, not more than +15% load) apply automatically with a note
on the card; everything else, and anything from a chat, becomes a proposal accepted with one tap (`tr_decide_proposal`).
Locked sessions and past dates are never touched.
