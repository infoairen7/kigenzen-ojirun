import sys, os, json
from playwright.sync_api import sync_playwright
STUB = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'three_stub.js')).read(); HTML = sys.argv[1]
with sync_playwright() as pw:
    b = pw.chromium.launch(); ctx = b.new_context(viewport={'width': 844, 'height': 390}, has_touch=True, is_mobile=True, locale='ja-JP'); page = ctx.new_page()
    errs = []; page.on('pageerror', lambda e: errs.append(str(e)))
    page.route('**/three.min.js', lambda r: r.fulfill(status=200, content_type='application/javascript', body=STUB))
    page.goto('file://' + HTML); page.wait_for_function('window.__torch && __torch.G && __torch.G.save'); page.wait_for_timeout(400)
    ev = page.evaluate; ev("__torch.G.save.tutorialDone = true; __torch.G.save.settings.chotto = false")
    ev("document.getElementById('len-short').click(); document.getElementById('mode-solo').click(); document.getElementById('btn-start').click()")
    for i in range(80):
        if ev("__torch.G.state") == 'running': break
        page.wait_for_timeout(100)
    ev("__torch.G.run.smashed.fill(1)")
    ev("document.getElementById('t-run').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }))")
    page.wait_for_timeout(2500)
    r = ev("({ vz: __torch.G.run.p.vz, taps: __torch.G.run.stats.taps, hint: (document.getElementById('hint')||{}).textContent })")
    ev("document.getElementById('t-run').dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch' }))")
    page.wait_for_timeout(600); t1 = ev("__torch.G.run.stats.taps"); page.wait_for_timeout(500); t2 = ev("__torch.G.run.stats.taps")
    print(json.dumps(r, ensure_ascii=False), 'after release taps', t1, t2, 'touch hold ok' if r['vz'] > 8.5 and t1 == t2 else 'TOUCH HOLD FAIL', errs[:3])
    b.close()
