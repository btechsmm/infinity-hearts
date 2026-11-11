# Testing

Everything marked PASS below was actually run in the build environment. Things that could not be run are listed as **not tested**.

## How to run
```bash
npm test                                   # unit tests (Node, no dependencies)
bash tests/db/run.sh [socket_dir] [port]   # database + Row Level Security tests on a local PostgreSQL 16
node scripts/dev-server.mjs 5173 &         # then:
python3 tests/e2e/smoke.py                 # browser test, local mode (headless Chrome + Playwright)
python3 tests/e2e/cloud.py                 # browser test, cloud flows against a FAKE Supabase client
```

## Results (last run)
| Suite | Result |
|---|---|
| Unit (`tests/*.test.mjs`) | 35 / 35 pass |
| Database security (`tests/db`) | 52 / 52 checks pass, real PostgreSQL 16.15, Supabase `auth`/`storage` schemas stubbed |
| Browser, local mode (`smoke.py`) | 25 / 25 pass |
| Browser, cloud flows (`cloud.py`) | 23 / 23 pass, against an in-memory fake of the Supabase client |

## Your 20 required tests

| # | Requirement | Where covered | Status |
|---|---|---|---|
| 1 | Departure in the past | unit; browser (counters compared with the clock) | PASS |
| 2 | Departure in the future | unit (no negative elapsed, "begins in" state, no milestone) | PASS |
| 3 | Exactly one day elapsed | unit | PASS |
| 4 | Thirty days | unit | PASS |
| 5 | One hundred days | unit | PASS |
| 6 | One year | unit | PASS |
| 7 | Leap year (the 731-day journey spans 29 Feb 2028; 29 Feb events on 28 Feb in common years) | unit | PASS |
| 8 | Return date changed | unit | PASS |
| 9 | Countdown reaches zero | unit (no negative, reunion-day milestone, actual reunion stops elapsed) | PASS |
| 10 | Milestone generated once | unit (keys), database (`unique (couple_id, milestone_date)`), browser (one row per date) | PASS |
| 11 | Offline startup | browser: reload with network off, shell from service worker, counters keep ticking, saved data present | PASS (headless Chrome) |
| 12 | Reconnect and sync | browser, fake Supabase: queued messages upload in order | PASS (fake client) |
| 13 | Duplicate message prevention | database (`unique (sender_id, client_id)`); browser: lost-response retry leaves one copy | PASS |
| 14 | Special dates across a year boundary | unit | PASS |
| 15 | Time zones | unit (Nairobi, Bahrain, UTC, New York DST; per-recipient notification windows) | PASS |
| 16 | Notification permission denied | browser (permission stubbed to denied: clear message, no broken button) | PASS |
| 17 | Missing couple photographs | browser (welcome falls back to artwork, no errors) | PASS |
| 18 | Expired authentication | browser, fake client: app locks and asks to sign in | PASS (fake client) |
| 19 | Unauthorised account reading messages | database on real PostgreSQL: stranger and anon blocked for every table and storage; browser: non-member sees nothing | PASS |
| 20 | Sign-out and local data | browser: all IndexedDB stores empty after sign-out; a different account on the same device starts with a wiped cache | PASS |

## Not tested (needs you)
* A real Supabase project: Auth emails, Realtime delivery, Storage signed URLs, `pg_cron`, Edge Function deployment.
* Real push delivery to Android or iPhone, and its timing on your phones.
* The native Android build and offline local notifications (not built).
* Real phones: install prompt, back button, keyboard resize, low-end performance, screen readers (TalkBack/VoiceOver).
* Automated accessibility audit and contrast measurements (colours were chosen for high contrast, not measured).
* Edge Function code was syntax-reviewed only; Deno is not installed here. Its planning logic is unit-tested.

## Manual device checklist
1. Install from Chrome (Android) and Safari (iPhone); open in standalone mode.
2. Sign in as each partner; confirm greeting, counters, and that each sees only their own notification preferences.
3. Airplane mode: reopen the app, confirm counters, quotes, dates, photos and previous messages; write two messages; reconnect and confirm both arrive once, in order.
4. Turn on notifications; press "Send a real test from the server"; then wait for a scheduled morning message.
5. Change the return date on one phone; confirm the other updates.
6. Upload three photos; reopen the app several times; confirm the welcome photo changes each time.
7. Sign out and confirm nothing private remains (reopen offline).
