"""Cloud-mode flows against a FAKE Supabase client (tests/e2e/fake-supabase.js). Run:
   node scripts/dev-server.mjs 5173 &  python3 tests/e2e/cloud.py [outdir]
Verifies the app's own logic: sign-in, outbox queue, reconnect sync, duplicate prevention, expiry, sign-out wipe, push denied."""
import sys, os
from playwright.sync_api import sync_playwright

OUT = sys.argv[1] if len(sys.argv) > 1 else "e2e-out"; BASE = os.environ.get("BASE", "http://localhost:5173")
os.makedirs(OUT, exist_ok=True)
STUB = open(os.path.join(os.path.dirname(__file__), "fake-supabase.js")).read()
CFG = 'window.IH_CONFIG={SUPABASE_URL:"https://fake-project.supabase.co",SUPABASE_ANON_KEY:"fake-anon-key-for-tests-only",VAPID_PUBLIC_KEY:""};'
results = []
def check(name, ok, detail=""):
    results.append(ok); print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail else ""))

def idb_counts(page):
    return page.evaluate("""async () => { const db = await new Promise((r, j) => { const q = indexedDB.open('infinity-hearts'); q.onsuccess = () => r(q.result); q.onerror = j; });
      const out = {}; for (const s of db.objectStoreNames) { out[s] = await new Promise(r => { const q = db.transaction(s).objectStore(s).count(); q.onsuccess = () => r(q.result); }); } db.close(); return out; }""")
def srv(page, expr): return page.evaluate(f"() => {expr}")
def thread_text(page): return page.inner_text(".thread") if page.query_selector(".thread") else ""

with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    ctx = b.new_context(viewport={"width": 390, "height": 844}, timezone_id="Africa/Nairobi", service_workers="block")
    ctx.route(lambda u: u.endswith("/config.js") and "/src/" not in u, lambda r: r.fulfill(body=CFG, content_type="text/javascript"))
    ctx.route("**/@supabase/supabase-js@2/**", lambda r: r.fulfill(body=STUB, content_type="text/javascript"))
    ctx.route("**/tile.openstreetmap.org/**", lambda r: r.abort())
    ctx.route("**/unpkg.com/**", lambda r: r.abort())
    ctx.add_init_script("Object.defineProperty(Notification, 'permission', { get: () => 'denied' });")
    page = ctx.new_page(); errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))

    # 1. signed out: login only, nothing private
    page.goto(BASE + "/"); page.wait_for_selector("form")
    check("signed-out visitor sees only the sign-in form", "Sign in" in page.inner_text("body") and not page.query_selector(".counter") and not page.query_selector(".tabs"))
    check("no public sign-up option", "sign up" not in page.inner_text("body").lower() and "create account" not in page.inner_text("body").lower())

    # 2. wrong password
    page.fill("input[type=email]", "becam@test.local"); page.fill("input[type=password]", "wrong"); page.click("button[type=submit]")
    page.wait_for_selector(".err:not(:empty)")
    check("wrong password shows a friendly error", "not right" in page.inner_text(".err"))

    # 3. sign in; settings come from the server, not hardcoded
    page.fill("input[type=password]", "good-pass"); page.click("button[type=submit]")
    page.wait_for_selector(".welcome"); page.click(".welcome button"); page.wait_for_selector(".counter b")
    page.wait_for_timeout(600)
    days = int(page.eval_on_selector(".counter", "e => e.querySelector('b').textContent"))
    check("countdown uses the departure date loaded from the server (1 Oct, not the 20 Oct default)", days >= 33, f"{days} days elapsed")
    check("personal greeting from the signed-in profile", "Becam" in page.inner_text("h1"))
    check("milestone synced to the server exactly once", len([r for r in srv(page, "window.__SB.t.milestones")]) >= 1 and len({r['milestone_date'] for r in srv(page, "window.__SB.t.milestones")}) == len(srv(page, "window.__SB.t.milestones")))
    check("data cached to IndexedDB for offline use", idb_counts(page)["quotes"] > 0 and idb_counts(page)["milestones"] > 0)

    # 4. send online
    page.goto(BASE + "/#/messages"); page.wait_for_selector(".composer textarea")
    page.fill(".composer textarea", "Hello my love"); page.click("button[aria-label='Send message']"); page.wait_for_timeout(500)
    check("online message delivered to the server", srv(page, "window.__SB.t.messages.length") == 1 and "Hello my love" in thread_text(page))

    # 5. offline: queue
    ctx.set_offline(True); page.wait_for_timeout(300)
    for t in ["Offline one", "Offline two"]:
        page.fill(".composer textarea", t); page.click("button[aria-label='Send message']"); page.wait_for_timeout(250)
    check("offline messages are queued, not lost, and marked as waiting", "Waiting for connection" in thread_text(page) and srv(page, "window.__SB.t.messages.length") == 1, thread_text(page).replace("\n", " | ")[:120])
    check("queue persisted in IndexedDB", idb_counts(page)["outbox"] == 2)
    page.screenshot(path=f"{OUT}/10-offline-queue.png")

    # 6. reconnect: flush in order, once
    ctx.set_offline(False); page.wait_for_timeout(1500)
    msgs = srv(page, "window.__SB.t.messages.map(m => m.content)")
    check("reconnect uploads queued messages in order, no duplicates", msgs == ["Hello my love", "Offline one", "Offline two"], str(msgs))
    check("outbox empty after sync", idb_counts(page)["outbox"] == 0 and "Waiting for connection" not in thread_text(page))

    # 7. lost response -> retry must not duplicate
    page.evaluate("window.__SB.dropAfterInsert = 1")
    page.fill(".composer textarea", "Dropped response"); page.click("button[aria-label='Send message']"); page.wait_for_timeout(600)
    mid = page.evaluate("window.__SB.t.messages.filter(m => m.content === 'Dropped response').length")
    page.evaluate("window.dispatchEvent(new Event('online'))"); page.wait_for_timeout(1200)
    after = page.evaluate("window.__SB.t.messages.filter(m => m.content === 'Dropped response').length")
    shown = thread_text(page).count("Dropped response")
    check("retry after a lost response creates no duplicate (server and screen)", mid == 1 and after == 1 and shown == 1, f"server {mid}->{after}, screen {shown}")

    # 8. realtime incoming from partner
    page.evaluate("""window.__SB.deliver({ id: 'inc1', couple_id: 'cccccccc-0000-4000-8000-000000000009', client_id: 'k1', sender_id: 'ffffffff-0000-4000-8000-000000000002', recipient_id: 'bbbbbbbb-0000-4000-8000-000000000001', message_type: 'text', content: 'Hi from Faith', sent_at: new Date().toISOString(), read_at: null, deleted_at: null })""")
    page.wait_for_timeout(500)
    check("realtime message from partner appears live", "Hi from Faith" in thread_text(page))
    page.wait_for_timeout(500)
    check("incoming message marked read while the thread is open", page.evaluate("window.__SB.t.messages.find(m => m.id === 'inc1').read_at") is not None)

    # 9. push permission denied
    page.goto(BASE + "/#/settings"); page.wait_for_timeout(700)
    st = page.inner_text("main")
    check("notification permission denied: clear message, no broken enable button", "blocked" in st.lower() and not page.query_selector("button:has-text('Turn on notifications')"))

    # 10. missing photos: welcome falls back gracefully
    check("no photos uploaded: app works and welcome used the artwork fallback (no error)", idb_counts(page)["photos"] == 0 and not errors, "; ".join(errors[:3]))

    # 11. expired session
    page.evaluate("window.__SB.expire()"); page.wait_for_selector("form", timeout=5000)
    check("expired session locks the app and asks to sign in again", "session has ended" in page.inner_text("body").lower() and not page.query_selector(".tabs"))

    # 12. a different (unauthorised) account on the same device sees nothing and the cache is wiped
    page.fill("input[type=email]", "mallory@test.local"); page.fill("input[type=password]", "good-pass"); page.click("button[type=submit]")
    page.wait_for_timeout(1200)
    body = page.inner_text("body")
    c = idb_counts(page)
    check("non-member account is refused: no couple data shown", "not part of this couple" in body and "Hello my love" not in body and "Hi from Faith" not in body)
    check("previous account's cached messages/photos were wiped for the new account", c["messages"] == 0 and c["outbox"] == 0 and c["photos"] == 0 and c["milestones"] == 0, str(c))

    # 13. sign out wipes everything
    page.click("button:has-text('Sign out')"); page.wait_for_selector("form")
    page.fill("input[type=email]", "becam@test.local"); page.fill("input[type=password]", "good-pass"); page.click("button[type=submit]")
    page.wait_for_selector(".welcome"); page.click(".welcome button"); page.wait_for_selector(".tabs"); page.wait_for_timeout(800)
    check("re-signed in as Becam: data reloads from the server", idb_counts(page)["quotes"] > 0)
    page.goto(BASE + "/#/settings"); page.wait_for_timeout(600)
    page.click("button:has-text('Sign out')"); page.wait_for_selector(".modal button.danger"); page.click(".modal button.danger")
    page.wait_for_selector("form"); page.wait_for_timeout(300)
    c = idb_counts(page)
    check("sign-out clears all private data on the device", sum(v for k, v in c.items()) == 0, str(c))
    check("sign-out returns to the sign-in screen with no private content", not page.query_selector(".counter") and "Sign in" in page.inner_text("body"))
    b.close()

print(f"\n{sum(results)}/{len(results)} passed"); sys.exit(0 if all(results) else 1)
