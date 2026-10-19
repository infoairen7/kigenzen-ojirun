"""In a race, the HUD panels never overlap each other or leave the screen, at itch.io embed sizes and phones (JA and EN)."""
import sys, os, json
from playwright.sync_api import sync_playwright
STUB = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'three_stub.js')).read(); PAGE = sys.argv[1]; SHOT = sys.argv[2] if len(sys.argv) > 2 else None; bad = []
with sync_playwright() as pw:
    b = pw.chromium.launch()
    for loc in ('en-US', 'ja-JP'):
        for vp, mob in (((960, 540), False), ((1280, 720), False), ((800, 450), False), ((1024, 576), False), ((844, 390), True), ((740, 360), True), ((667, 375), True), ((932, 430), True), ((1920, 1080), False)):
            ctx = b.new_context(viewport={'width': vp[0], 'height': vp[1]}, locale=loc, is_mobile=mob, has_touch=mob); page = ctx.new_page()
            page.route('**/three.min.js', lambda r: r.fulfill(status=200, content_type='application/javascript', body=STUB)); page.route('https://fonts.**', lambda r: r.abort())
            page.goto('file://' + PAGE); page.wait_for_function('window.__torch && __torch.G && __torch.G.save'); page.wait_for_timeout(300)
            ev = page.evaluate; ev("document.getElementById('%s').click(); __torch.G.save.tutorialDone = true" % ('lang-en' if loc == 'en-US' else 'lang-ja'))
            ev("document.getElementById('mode-race').click(); document.getElementById('btn-start').click()")
            for i in range(80):
                if ev("__torch.G.state") == 'running': break
                page.wait_for_timeout(100)
            ev("__torch.G.run.smashed.fill(1); __torch.G.run.buffs.wig = 8"); page.keyboard.down('Space'); page.wait_for_timeout(1500)
            r = ev("""(() => { const els = [...document.querySelectorAll('#hud .hud-panel, #hud .hud-bl')].filter(e => e.offsetParent && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0);
              const R = els.map(e => { const r = e.getBoundingClientRect(); return { n: e.className.replace('hud-panel ', ''), l: r.left, t: r.top, r: r.right, b: r.bottom }; });
              const hits = []; for (let i = 0; i < R.length; i++) for (let j = i + 1; j < R.length; j++) { const a = R[i], c = R[j]; if (a.l < c.r - 1 && c.l < a.r - 1 && a.t < c.b - 1 && c.t < a.b - 1) hits.push(a.n + ' x ' + c.n); }
              const out = R.filter(a => a.l < -1 || a.t < -1 || a.r > innerWidth + 1 || a.b > innerHeight + 1).map(a => a.n);
              return { n: R.length, hits, out }; })()""")
            good = not r['hits'] and not r['out']
            if not good: bad.append((loc, vp, r))
            print(loc, vp, 'ok' if good else 'BAD', json.dumps(r, ensure_ascii=False))
            if SHOT and vp == (960, 540) and loc == 'en-US': page.screenshot(path=SHOT)
            ctx.close()
    b.close()
print('hud overlap:', 'all ok' if not bad else bad)
