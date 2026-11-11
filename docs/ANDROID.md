# Optional: native Android build with Capacitor

**Status: not built.** The files here (`capacitor.config.json`, `src/js/native.js`) are prepared, but the build environment
could not install npm packages or the Android SDK, so no APK/AAB exists and nothing below has been run on a device.
Do not treat the app as an Android package until you have built and tested it.

## Why
The installed PWA cannot deliver a reminder while the phone has no internet. A native wrapper can schedule
**local** notifications that Android fires on its own. If occasional push-based reminders are enough, skip this.

## Build (on your computer with Node 20+, JDK 17+, Android Studio)
```bash
npm install @capacitor/core @capacitor/cli @capacitor/android @capacitor/local-notifications
SUPABASE_URL=... SUPABASE_ANON_KEY=... VAPID_PUBLIC_KEY=... node scripts/build.mjs   # produces dist/
npx cap add android
npx cap sync android
npx cap open android            # Android Studio → Build → Build APK(s)
```
In `android/app/src/main/AndroidManifest.xml` confirm (the plugin docs list exact current requirements):
* `POST_NOTIFICATIONS` permission (Android 13+; the app requests it at runtime)
* the plugin's boot receiver, so scheduled reminders are restored after a reboot
* exact-alarm permission only if you change `schedule` to exact times (inexact `allowWhileIdle` is used by default)

Add a small notification icon `ic_stat_icon` (white-on-transparent) to `android/app/src/main/res/drawable*`.
The web app already handles: bottom navigation, safe-area insets (`viewport-fit=cover`), keyboard-aware sticky composer,
and Android back (hash routes + modals push a history entry so Back closes the sheet first).

## Test checklist (real phone)
1. Install, open, grant notification permission.
2. Turn on airplane mode, set the morning time two minutes ahead, lock the phone: the reminder must appear.
3. Reboot with airplane mode on: reminders must still fire.
4. Back button closes a modal, then navigates, then exits.
5. Keyboard does not hide the message box; nothing is clipped under the status/navigation bars.
6. Test on a low-end phone for smooth scrolling.
Record failures in `docs/TESTING.md`.
