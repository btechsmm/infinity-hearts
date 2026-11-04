# Infinity Hearts · Becam & Faith

A private, installable, offline-capable countdown and love-letter app for a couple separated by distance
(Becam in Nairobi, Faith in Manama). Vanilla JavaScript PWA + Supabase + Render static hosting.

> **Status:** application code, database, tests and docs are complete and tested as described in
> [`docs/TESTING.md`](docs/TESTING.md). It has **not been deployed** and has **not been tried against a real
> Supabase project, a real phone, or a real push service** (none were reachable from the build environment).
> [Known limitations](#known-limitations-read-this) lists exactly what is unverified.

## What it does

| Area | Details |
|---|---|
| Welcome | Logo, "INFINITY HEARTS / BECAM & FAITH", rotating couple photo (never the same one twice in a row), dark overlay for legibility |
| Home | Greeting by signed-in profile and local time, live **time apart** and **until we meet again** counters, journey progress, Nairobi–Manama map, today's quote, next special date, latest milestone |
| Our Journey | Large counters, progress, upcoming key milestones, milestone history (key moments / every day) |
| Love Quotes | 73 original messages: daily / weekly / monthly, 10 categories, personal (Becam to Faith, Faith to Becam, shared, general), favourites, history, copy, native share, share as image, send as a message |
| Special Dates | Anniversary (8 Sep, yearly), Valentine's, Christmas, New Year's Eve/Day, planned reunion (one-time), birthdays and custom dates; reminders 7/3/1/0 days before; leap-year safe |
| Messages | Private couple chat, realtime, read receipts, unread badge, **offline queue with automatic sync**, duplicate-proof retries, soft delete of your own messages |
| Memories | Upload, caption, hide/show in rotation, delete; stored in a **private** bucket and cached on the device for offline |
| Settings | Profile, departure/return date-times (time-zone aware), notification preferences, text size, motion, sync, privacy, install help, sign-out |

All counters are computed from the timestamps stored in Supabase (`couple_settings`). Nothing is hardcoded into the UI.
Until you set exact times, the documented default is **00:00 Africa/Nairobi** on 20 Oct 2026 and 20 Oct 2028
(Settings → Couple details). Live hours/minutes/seconds come from timestamps; the "days" sentence uses calendar days in the home time zone.

## Architecture

```
index.html  sw.js  manifest.webmanifest        PWA shell (service worker precaches it)
src/js/core/        pure engine: time, milestones, special dates, quotes, geo, notification planner (unit-tested)
src/js/api.js       data layer: Supabase (cloud mode) or IndexedDB-only (local mode), outbox, realtime
src/js/views/       Home, Journey, Quotes, Dates, Messages, Memories, Settings
supabase/migrations/   schema, couple membership, Row Level Security, private storage policies
supabase/seed.sql      quote library (generated from src/data/quotes.json)
supabase/functions/send-notifications/   scheduled Web Push (Edge Function)
supabase/cron.sql      pg_cron schedule (template, fill in two placeholders)
tests/                 unit, database security, browser end-to-end
```

Two run modes, chosen automatically:
* **Local mode** (no Supabase variables): everything except sign-in, messaging and push works, data stays on the device. Good for trying the app.
* **Cloud mode** (Supabase configured): sign-in required, shared settings/events/photos/messages, push.

## Setup

Prerequisites: Node 20+, a free [Supabase](https://supabase.com) project, a [Render](https://render.com) account, the
[Supabase CLI](https://supabase.com/docs/guides/cli). Python 3 + Playwright + Chrome only if you want to run the browser tests.

### 1. Try it locally (no accounts needed)
```bash
npm run dev            # http://localhost:5173  (local mode)
npm test               # unit tests
```

### 2. Create the Supabase backend
```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push                         # applies supabase/migrations/*  (tables, RLS, storage policies)
psql "$DB_URL" -f supabase/seed.sql      # or paste supabase/seed.sql into the SQL editor
```
In the Supabase dashboard:
1. **Authentication → Providers → Email**: keep email+password on, **turn OFF "Allow new users to sign up"** (this is a private app for two).
2. **Authentication → URL Configuration**: set *Site URL* and add *Redirect URLs* for your Render address (password-reset links need it).
3. **Authentication → Users → Add user**: create two users (email + password, tick "auto confirm"): Becam's and Faith's.

### 3. Provision the couple (secure membership)
Only the two emails you register here can ever see couple data. Run once in the SQL editor:
```sql
select public.provision_couple('becam@example.com', 'faith@example.com');
```
This creates the couple, settings (with the documented default dates), the six default special dates, and links the two
accounts (whichever order you create users and run this). Anyone else who somehow signs in gets no profile and no access
(see `tests/db/10_rls_tests.sql`). Public sign-up being off is a second layer; the database rules are the real protection.

### 4. Push notifications (optional but recommended)
```bash
node scripts/gen-vapid.mjs                                  # prints a public and a private key
supabase secrets set VAPID_PRIVATE_KEY=... VAPID_PUBLIC_KEY=... VAPID_SUBJECT=mailto:you@example.com CRON_SECRET=<long random>
node scripts/sync-shared.mjs                                # keep the function's engine copy in step (tests check this)
supabase functions deploy send-notifications
```
Then open `supabase/cron.sql`, replace `<PROJECT_URL>` and `<CRON_SECRET>`, and run it in the SQL editor.
Read [`docs/NOTIFICATIONS.md`](docs/NOTIFICATIONS.md) for what this can and cannot guarantee.

### 5. Deploy the site on Render
1. Push this folder to a Git repository and create a **Blueprint** on Render from `render.yaml` (or a *Static Site* with build command `node scripts/build.mjs`, publish directory `dist`).
2. Set the environment variables: `SUPABASE_URL`, `SUPABASE_ANON_KEY` (the **publishable/anon** key only), `VAPID_PUBLIC_KEY`.
3. Open the site on each phone, sign in, then install it (Android Chrome: ⋮ → *Install app*; iPhone Safari: Share → *Add to Home Screen*, required for push on iOS).
4. Open **Settings → Notifications → Turn on notifications**, then **Send a real test from the server**.
5. Upload your photos in **Memories** (they are used on the welcome screen). Photos are resized, never altered.

Never put the **service-role key** anywhere except Supabase's own function environment (Supabase injects it automatically).

## Date and time rules

* Elapsed = now − departure, remaining = return − now, progress = elapsed ÷ (return − departure), clamped to 0–100%.
* Before departure: a "journey begins in …" state, never negative elapsed time. After the return time: a reunion-day state, never a negative countdown. "We are together" (shown on reunion day) records the actual reunion; elapsed time then stops and the history is kept.
* Changing the return date recalculates everything immediately and syncs to both phones.
* One milestone per calendar day, keyed by date (`unique (couple_id, milestone_date)`), so re-opening the app or running the scheduler twice cannot duplicate it.
* Extra milestone rules can be added in `couple_settings.custom_milestone_rules`, e.g.
  `[{"kind":"elapsed","days":77,"title":"Day {elapsed}","message":"{elapsed} days. {remaining} to go.","priority":99}]`
  (placeholders: `{elapsed} {remaining} {total} {months}`; `kind` is `elapsed` or `remaining`).

## Known limitations (read this)

* **Not deployed, not run against real Supabase.** The migration and every Row Level Security rule were run and tested against real PostgreSQL 16 with Supabase's `auth`/`storage` schemas stubbed (52 checks). The app's cloud flows were tested against an in-memory stand-in for the Supabase client. The first real deployment may surface integration issues (for example Realtime must be enabled for the `messages` table, which the migration requests).
* **Push is untested end to end.** The service worker, subscription code, planner (unit-tested) and Edge Function are written, but nothing could be delivered to a real device from the build environment. Use the in-app "real test from the server" button after deploying.
* **No offline scheduled notifications on the web.** See `docs/NOTIFICATIONS.md`. A native Android build is the only way to get them, and that build has **not** been produced.
* **No generated artwork.** No image-generation tool was available. The logo, icons and welcome artwork are hand-drawn SVG; the welcome screen shows that artwork until you upload real photos. Quote-card backgrounds are CSS/canvas, not photographic.
* **Libraries load from CDNs** (supabase-js from jsDelivr, Leaflet from unpkg, map tiles from OpenStreetMap) and are cached after first use. `npm install` was blocked in the build environment, so they could not be vendored; `scripts/vendor.mjs` does it on your machine. OpenStreetMap's public tile server is for light use; switch `tileUrl` in `src/js/config.js` to a commercial tile provider if usage grows.
* **The map offline fallback has no coastlines.** It shows a coordinate-accurate latitude/longitude grid with both cities and the route, clearly labelled as an illustration.
* **Distance:** the great-circle distance Nairobi to Manama computes to **≈ 3,398 km (2,111 mi)**. The sample mock-up image showed 5,006 km, which does not match these coordinates; the app shows the computed value.
* Messages are **not end-to-end encrypted**: they are private by sign-in and database rules, but Supabase can technically access them. The app says so in Settings → Privacy.
* Browsers may be refused the install prompt or delay background pushes on some phones; behaviour varies by Android make and iOS version.

## Layout of the docs

* [`docs/TESTING.md`](docs/TESTING.md): what was run, results, and the manual device checklist
* [`docs/NOTIFICATIONS.md`](docs/NOTIFICATIONS.md): web vs installed PWA vs native, limits
* [`docs/ANDROID.md`](docs/ANDROID.md): optional Capacitor build for reliable offline reminders
* [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md)
