"""The top-left HUD panel never overflows (checked in top gear, where the TOP badge shows), at desktop and phone sizes, JA and EN."""
import sys, os, json
from playwright.sync_api import sync_playwright
STUB = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'three_stub.js')).read(); HTML = sys.argv[1]; bad = []
with sync_playwright() as pw:
    b = pw.chromium.launch()
    for loc in ('ja-JP', 'en-US'):
        for vp in ((1280, 720), (844, 390), (1920, 1080), (1024, 768), (960, 540), (1024, 576), (800, 450)):
            ctx = b.new_context(viewport={'width': vp[0], 'height': vp[1]}, locale=loc); page = ctx.new_page()
            page.route('**/three.min.js', lambda r: r.fulfill(status=200, content_type='application/javascript', body=STUB))
            page.goto('file://' + HTML); page.wait_for_function('window.__torch && __torch.G && __torch.G.save'); page.wait_for_timeout(300)
            ev = page.evaluate; ev("__torch.G.save.tutorialDone = true")
            ev("document.getElementById('len-short').click(); document.getElementById('mode-race').click(); document.getElementById('btn-start').click()")
            for i in range(80):
                if ev("__torch.G.state") == 'running': break
                page.wait_for_timeout(100)
            ev("__torch.G.run.smashed.fill(1)"); page.keyboard.down('Space'); page.wait_for_timeout(1500)
            pre = ev("""(() => { const p = document.querySelector('.hud-tl'), pr = p.getBoundingClientRect(); let maxR = 0;
              p.querySelectorAll('*').forEach(e => { const r = e.getBoundingClientRect(); if (r.width && getComputedStyle(e).visibility !== 'hidden') maxR = Math.max(maxR, r.right); });
              return { panelRight: Math.round(pr.right), contentRight: Math.round(maxR), spd: document.getElementById('spd').textContent }; })()""")
            if pre['contentRight'] > pre['panelRight']: bad.append((loc, vp, 'before top gear', pre))
            ev("__torch.G.run.momentum = 2.5")
            for i in range(40):
                if ev("!document.getElementById('top-badge').hidden"): break
                page.wait_for_timeout(100)
            r = ev("""(() => { const p = document.querySelector('.hud-tl'), row = document.querySelector('.mom-row'), pr = p.getBoundingClientRect(); let maxR = 0;
              p.querySelectorAll('*').forEach(e => { const r = e.getBoundingClientRect(); if (r.width && getComputedStyle(e).visibility !== 'hidden') maxR = Math.max(maxR, r.right); });
              return { badge: !document.getElementById('top-badge').hidden, pips: !document.getElementById('pips').hidden, panelRight: Math.round(pr.right), contentRight: Math.round(maxR), spd: document.getElementById('spd').textContent }; })()""")
            ok = r['badge'] and not r['pips'] and r['contentRight'] <= r['panelRight']
            if not ok: bad.append((loc, vp, r))
            print(loc, vp, 'ok' if ok else 'BAD', json.dumps(r)); ctx.close()
    b.close()
print('hud fit:', 'all ok' if not bad else bad)
