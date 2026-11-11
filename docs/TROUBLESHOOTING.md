# Troubleshooting

**The app says "Local mode" behaviour (no sign-in).** `SUPABASE_URL`/`SUPABASE_ANON_KEY` were empty at build time. Set them on Render and redeploy. `node scripts/build.mjs` prints whether Supabase was configured.

**"Invalid login" for the right password.** Confirm the user exists and is confirmed under Authentication → Users. Passwords are case-sensitive.

**"This account is not part of this couple's space".** The email was not passed to `provision_couple(...)`. Run it with the exact email addresses (lower-case matching), then sign in again.

**Password reset email link opens the wrong page.** Set Site URL and Redirect URLs under Authentication → URL Configuration to your Render address.

**Nothing in Messages / partner shows as "Becam"/"Faith" wrongly.** The other partner must have signed in at least once or been provisioned; the Messages screen needs both members to exist.

**Messages don't arrive live.** Check Database → Replication that `messages` is in the `supabase_realtime` publication (the migration adds it). Messages still arrive on the next sync/open.

**A queued message never sends.** It stays queued until the phone is online *and* signed in. Check Settings → Data & sync. "Not sent" means the database refused it (for example you were removed from the couple); discard it.

**Photos don't upload.** Photos are limited to 8 MB (JPEG/PNG/WebP) and need an internet connection. The bucket `couple-photos` must exist (created by the migration) and stays private.

**Map shows a grid, not a real map.** Offline, or the OpenStreetMap/unpkg request failed. It is labelled as an illustration. Reconnect and revisit Home.

**Push button says "Push is not configured".** `VAPID_PUBLIC_KEY` is empty in the Render environment.
**"Send a real test" fails.** Check `supabase functions logs send-notifications`; confirm secrets `VAPID_PRIVATE_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT`, `CRON_SECRET` exist and the function was deployed after `node scripts/sync-shared.mjs`.
**No morning notification.** Confirm the cron job exists (`select * from cron.job;`), notifications are enabled on that phone, the morning time/time zone in Settings are right, and the phone has internet. Android battery savers may delay pushes; exempt the app.
**iPhone gets no push.** The app must be added to the Home Screen first (iOS 16.4+).

**App looks stale after a deploy.** The service worker updates in the background; close and reopen the app once. Chrome → DevTools → Application → Service Workers → *Unregister* for a hard reset.

**Dates look off by a day.** Departure/return are entered in the *home time zone* (default Africa/Nairobi). Day counts use calendar days in that zone, while the live clock uses exact timestamps.

**Tests: `tests/db/run.sh` can't connect.** Start a local PostgreSQL 16 cluster and pass the socket directory and port, or see the header of that script. Browser tests need Python Playwright and Chrome at `/usr/bin/google-chrome` (edit the path in `tests/e2e/*.py` if different).
