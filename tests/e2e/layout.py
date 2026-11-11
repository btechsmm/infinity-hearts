"""Layout + deployment-guard checks. Run: node scripts/dev-server.mjs 5173 &  python3 tests/e2e/layout.py [outdir]"""
import sys, os
from playwright.sync_api import sync_playwright
OUT = sys.argv[1] if len(sys.argv) > 1 else "e2e-out"; BASE = os.environ.get("BASE", "http://localhost:5173")
os.makedirs(OUT, exist_ok=True); results = []
def check(n, ok, d=""): results.append(ok); print(("PASS " if ok else "FAIL ") + n + (f"  [{d}]" if d else ""))

with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    # tall desktop window, like the screenshot: the map sits inside the visible area behind the welcome screen
    ctx = b.new_context(viewport={"width": 1280, "height": 1500}, service_workers="block")
    pg = ctx.new_page(); pg.goto(BASE + "/"); pg.wait_for_selector(".welcome")
    pg.wait_for_function("() => { const n = document.querySelector('.mapnote'); return n && !n.hidden }", timeout=15000)
    pg.wait_for_timeout(600)
    r = pg.evaluate("""() => { const n = document.querySelector('.mapnote').getBoundingClientRect();
      const top = document.elementFromPoint(n.x + n.width / 2, n.y + n.height / 2);
      const sw = document.querySelector('.mapbox svg.fallback') || document.querySelector('.mapbox'); const b = sw.getBoundingClientRect();
      const top2 = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
      return { inWelcome: !!top.closest('.welcome'), mapInWelcome: !!top2.closest('.welcome'), y: Math.round(n.y) } }""")
    pg.screenshot(path=f"{OUT}/20-welcome-over-map.png")
    check("welcome screen fully covers the map (nothing paints above it)", r["inWelcome"] and r["mapInWelcome"], str(r))
    pg.click(".welcome button"); pg.wait_for_selector(".welcome", state="detached")
    pg.evaluate("window.scrollTo(0, 300)")
    r = pg.evaluate("""() => { const t = document.querySelector('.topbar').getBoundingClientRect(); const m = document.querySelector('.mapbox').getBoundingClientRect();
      const el = document.elementFromPoint(t.x + 400, t.y + t.height / 2); return { topbarOnTop: !!el.closest('.topbar'), mapTop: Math.round(m.top) } }""")
    check("top bar stays above page content while scrolling", r["topbarOnTop"], str(r))
    # on a phone-width window the bottom tab bar must also stay above the map
    ph = ctx.new_page(); ph.set_viewport_size({"width": 390, "height": 844}); ph.goto(BASE + "/"); ph.wait_for_selector(".welcome"); ph.click(".welcome button")
    ph.wait_for_function("() => { const n = document.querySelector('.mapnote'); return n && !n.hidden }", timeout=15000)
    ph.evaluate("document.querySelector('.mapbox').scrollIntoView({block:'end'})"); ph.wait_for_timeout(500)
    r = ph.evaluate("""() => { const t = document.querySelector('.tabs').getBoundingClientRect(); const el = document.elementFromPoint(t.x + t.width / 2, t.y + t.height / 2); return !!el.closest('.tabs') }""")
    check("bottom navigation stays above the map on phones", r)
    ctx.close()

    # a hosted site with no database configured must NOT silently open in local mode
    ctx2 = b.new_context(viewport={"width": 390, "height": 844}, service_workers="block"); g = ctx2.new_page()
    def proxy(route):
        route.fulfill(response=route.fetch(url=route.request.url.replace("http://app.test", BASE)))
    ctx2.route("http://app.test/**", proxy)
    g.goto("http://app.test/"); g.wait_for_timeout(2500)
    t = g.inner_text("body")
    check("hosted site without Supabase settings shows a clear setup message, not the app", "not connected" in t.lower() and not g.query_selector(".counter"), t[:90].replace("\n", " "))
    b.close()
print(f"\n{sum(results)}/{len(results)} passed"); sys.exit(0 if all(results) else 1)
