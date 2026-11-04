# Notifications: what works where

A website cannot run JavaScript while closed, and ordinary browser notifications are not a promise of delivery.
This app therefore does **not** pretend to schedule anything from inside the page. The architecture is:

```
pg_cron (every 15 min) → Edge Function send-notifications → Web Push service → phone's service worker → notification
```

The function checks each person's own time zone and chosen morning time (default 08:00), builds the message from the
database (daily quote / milestone with real day counts / weekly on Mondays / monthly on the 1st / special-date reminders)
and **claims a unique row in `notification_log` before sending**, so reruns, overlaps and retries cannot send a duplicate.
Expired push subscriptions (HTTP 404/410) are deleted automatically.

| Capability | Browser tab | Installed PWA (Android Chrome) | Installed PWA (iPhone, iOS 16.4+) | Native Android app (Capacitor) |
|---|---|---|---|---|
| Countdown, quotes, dates, cached photos offline | Yes after first visit | Yes | Yes | Yes |
| Server-scheduled push (morning message, milestones, reminders) | Only if permission granted and the browser is allowed to run in background | Yes, needs internet on the phone at send time | Yes, **only after Add to Home Screen** | Yes (could also use FCM; not implemented) |
| Reminder while the phone has **no internet** | No | **No** | **No** | **Yes**, local notifications (see below) |
| Missed milestones/messages after reconnect | Synced on next open | Synced on next open | Synced on next open | Synced on next open |
| Survives phone reboot | n/a | Push subscription survives | Push subscription survives | Reboot rescheduling by the plugin's boot receiver (unverified) |

Important honest limits:
* Delivery needs the phone to be online when the push is sent. Phone makers' battery savers (many Android skins) and iOS can delay or drop background pushes. This is outside the app's control.
* If notification permission is denied the app keeps working; Settings explains how to re-enable it, and the daily message is still shown on the Home screen.
* The **"Send a real test from the server"** button invokes the Edge Function, which pushes to your own subscriptions through the real path. It is the only test button; there are no fake in-page "notifications".
* Notification content is never cached by the service worker. Push payloads contain only the message text.

## Native Android (offline reminders)
`src/js/native.js` schedules the next 45 mornings as **local notifications** with `@capacitor/local-notifications`
(notification channel, `allowWhileIdle`) using the same engine as the app screens, re-running each time the app opens.
Because it cannot be built in this environment it is **unverified on a real device**. See `ANDROID.md`.

## Setting up
See README → "Push notifications". Secrets: `VAPID_PRIVATE_KEY`, `CRON_SECRET` live only as Supabase function secrets.
