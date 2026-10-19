import sys, os, json
from playwright.sync_api import sync_playwright
STUB = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'three_stub.js')).read(); HTML = sys.argv[1]
with sync_playwright() as pw:
    b = pw.chromium.launch()
    for vp in ((1280, 720), (844, 390), (1920, 1080)):
        page = b.new_page(viewport={'width': vp[0], 'height': vp[1]})
        page.route('**/three.min.js', lambda r: r.fulfill(status=200, content_type='application/javascript', body=STUB))
        page.goto('file://' + HTML); page.wait_for_function('window.__torch && __torch.G && __torch.G.save'); page.wait_for_timeout(300)
        ev = page.evaluate; ev("__torch.G.save.tutorialDone = true")
        ev("document.getElementById('len-short').click(); document.getElementById('mode-race').click(); document.getElementById('btn-start').click()")
        for i in range(80):
            if ev("__torch.G.state") == 'running': break
            page.wait_for_timeout(100)
        ev("__torch.G.save.momHints = 0; __torch.G.momToast = false; __torch.G.run.smashed.fill(1)"); page.keyboard.down('Space'); page.wait_for_timeout(1700); ev("__torch.G.run.momentum = 2.5")
        for i in range(40):
            if ev("!document.getElementById('toast').hidden"): break
            page.wait_for_timeout(100)
        r = ev("document.getElementById('toast').textContent")
        page.wait_for_timeout(300)
        out = ev("""(() => { const f = (el) => { const r = el.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.bottom), Math.round(r.left), Math.round(r.right)]; };
          return { panel: f(document.querySelector('.hud-tc')), toast: f(document.getElementById('toast')), tl: f(document.querySelector('.hud-tl') || document.body), tr: f(document.querySelector('.hud-tr') || document.body) }; })()""")
        print(vp, r[:20], json.dumps(out))
        page.close()
    b.close()
