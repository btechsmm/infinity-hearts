"""Headless-Chrome smoke test (local mode). Run: node scripts/dev-server.mjs 5173 & python3 tests/e2e/smoke.py
Needs python3 playwright and google-chrome. Screenshots go to the directory given as argv[1] (default ./e2e-out)."""
import sys, os, re, json, datetime
from playwright.sync_api import sync_playwright

OUT = sys.argv[1] if len(sys.argv) > 1 else "e2e-out"
BASE = os.environ.get("BASE", "http://localhost:5173")
os.makedirs(OUT, exist_ok=True)
results = []
def check(name, ok, detail=""):
    results.append((name, ok, detail)); print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail else ""))

with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, timezone_id="Africa/Nairobi", service_workers="allow")
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}") if m.type == "error" else None)

    page.goto(BASE + "/")
    page.wait_for_selector(".welcome")
    page.wait_for_timeout(900)
    page.screenshot(path=f"{OUT}/01-welcome.png")
    check("welcome shows INFINITY HEARTS and BECAM & FAITH", "INFINITY" in page.inner_text(".welcome") and "BECAM & FAITH" in page.inner_text(".welcome"))
    page.click(".welcome button")
    page.wait_for_selector(".welcome", state="detached")

    # ---- counters vs the clock
    page.wait_for_selector(".counter b")
    page.wait_for_timeout(1200)
    vals = page.eval_on_selector_all(".counter", "els => els.map(e => [...e.querySelectorAll('b')].map(b => b.textContent))")
    now = datetime.datetime.now(datetime.timezone.utc)
    dep = datetime.datetime(2026, 10, 19, 21, 0, tzinfo=datetime.timezone.utc)
    ret = datetime.datetime(2028, 10, 19, 21, 0, tzinfo=datetime.timezone.utc)
    def split(td):
        s = int(td.total_seconds()); return [s // 86400, (s % 86400) // 3600, (s % 3600) // 60, s % 60]
    exp_el, exp_re = split(now - dep), split(ret - now)
    got_el, got_re = [int(x) for x in vals[0]], [int(x) for x in vals[1]]
    check("elapsed counter matches timestamps (days/hours/min within 1 min)", got_el[:2] == exp_el[:2] and abs(got_el[2] - exp_el[2]) <= 1, f"{got_el} vs {exp_el}")
    check("remaining counter matches timestamps", got_re[0] == exp_re[0] and abs(got_re[1] - exp_re[1]) <= 1, f"{got_re} vs {exp_re}")
    s1 = page.eval_on_selector(".counter", "e => e.querySelectorAll('b')[3].textContent")
    page.wait_for_timeout(2100)
    s2 = page.eval_on_selector(".counter", "e => e.querySelectorAll('b')[3].textContent")
    check("seconds tick live without refresh", s1 != s2, f"{s1} -> {s2}")
    txt = page.inner_text("main")
    check("calendar-day message present", "We have already made it through" in txt)
    check("greeting present", re.search(r"Good (morning|afternoon|evening), Becam", txt) is not None)
    check("progress shown with stats", "Days elapsed" in txt and "Completed" in txt)
    check("map section with approximate distance", "3,398 km" in txt or "3,39" in txt, re.findall(r"≈ [\d,]+ km", txt)[0] if re.findall(r"≈ [\d,]+ km", txt) else "no distance")
    check("daily quote shown", "TODAY’S MESSAGE" in txt.upper())
    check("next special date shown", "NEXT SPECIAL DATE" in txt.upper())
    page.screenshot(path=f"{OUT}/02-home.png", full_page=True)

    # ---- routes
    for r in ["journey", "quotes", "dates", "messages", "memories", "settings"]:
        page.goto(f"{BASE}/#/{r}")
        page.wait_for_timeout(500)
        page.screenshot(path=f"{OUT}/03-{r}.png", full_page=True)
        check(f"route #{r} renders content", len(page.inner_text("main").strip()) > 20)

    page.goto(f"{BASE}/#/dates"); page.wait_for_timeout(300)
    d = page.inner_text("main")
    check("special dates include anniversary, Valentine's, Christmas, New Year, reunion", all(k in d for k in ["Our Anniversary", "Valentine", "Christmas", "New Year's Eve", "New Year's Day", "Expected Return"]))

    # ---- add a custom date and photo (local mode persistence)
    page.click("text=Add")
    page.fill("input[type=text]", "Faith's birthday")
    page.fill("input[type=date]", "2000-03-14")
    page.click("button[type=submit]")
    page.wait_for_timeout(500)
    check("custom special date created", "Faith's birthday" in page.inner_text("main"))

    # ---- offline start
    page.goto(BASE + "/"); page.wait_for_timeout(1500)
    sw_ready = page.evaluate("navigator.serviceWorker.ready.then(r => !!r.active)")
    check("service worker active", sw_ready)
    page.reload(); page.wait_for_timeout(1500)   # now controlled by SW
    ctx.set_offline(True)
    page.reload()
    page.wait_for_timeout(2000)
    page.wait_for_selector(".welcome, .counter", timeout=8000)
    if page.query_selector(".welcome"): page.click(".welcome button"); page.wait_for_timeout(500)
    page.wait_for_selector(".counter b")
    off_txt = page.inner_text("main")
    check("offline startup works (shell cached)", "Time apart" in off_txt or "TIME APART" in off_txt.upper())
    check("offline indicator visible", page.is_visible(".netpill"))
    page.wait_for_timeout(1500)
    s1 = page.eval_on_selector(".counter", "e => e.querySelectorAll('b')[3].textContent"); page.wait_for_timeout(1100)
    s2 = page.eval_on_selector(".counter", "e => e.querySelectorAll('b')[3].textContent")
    check("countdown keeps running offline", s1 != s2)
    page.goto(f"{BASE}/#/dates"); page.wait_for_timeout(500)
    check("custom date persisted offline (IndexedDB)", "Faith's birthday" in page.inner_text("main"))
    page.screenshot(path=f"{OUT}/04-offline-dates.png")
    ctx.set_offline(False)

    # ---- desktop layout
    d = b.new_context(viewport={"width": 1280, "height": 800}, timezone_id="Africa/Nairobi").new_page()
    d.goto(BASE + "/"); d.wait_for_selector(".welcome"); d.click(".welcome button"); d.wait_for_timeout(800)
    d.screenshot(path=f"{OUT}/05-desktop.png")
    check("desktop shows side navigation incl. Settings", d.is_visible(".tabs .tab:has-text('Settings')"))

    real = [e for e in errors if "net::ERR" not in e and "Failed to load resource" not in e and "tile.openstreetmap" not in e and "unpkg" not in e]
    check("no JavaScript errors", not real, "; ".join(real[:4]))
    b.close()

failed = [r for r in results if not r[1]]
print(f"\n{len(results) - len(failed)}/{len(results)} passed")
sys.exit(1 if failed else 0)
