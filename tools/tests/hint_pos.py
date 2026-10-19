"""The first-run hints never sit on the year panel, at itch.io embed sizes and phones."""
import sys, os, json
from playwright.sync_api import sync_playwright
STUB = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'three_stub.js')).read(); PAGE = sys.argv[1]; bad = []
with sync_playwright() as pw:
    b = pw.chromium.launch()
    for vp, mob in (((960, 540), False), ((1280, 720), False), ((800, 450), False), ((844, 390), True), ((1024, 576), False)):
        ctx = b.new_context(viewport={'width': vp[0], 'height': vp[1]}, locale='en-US', is_mobile=mob, has_touch=mob); page = ctx.new_page()
        page.route('**/three.min.js', lambda r: r.fulfill(status=200, content_type='application/javascript', body=STUB)); page.route('https://fonts.**', lambda r: r.abort())
        page.goto('file://' + PAGE); page.wait_for_function('window.__torch && __torch.G && __torch.G.save'); page.wait_for_timeout(300)
        page.evaluate("document.getElementById('len-short').click(); document.getElementById('btn-start').click()")
        page.wait_for_function("__torch.G.state === 'running'", timeout=20000); page.wait_for_timeout(600)
        r = page.evaluate("""(() => { const h = document.getElementById('hint'), p = document.querySelector('.hud-tc').getBoundingClientRect(), hr = h.getBoundingClientRect();
          return { shown: !h.hidden, text: h.textContent.slice(0, 40), hintTop: Math.round(hr.top), panelBottom: Math.round(p.bottom) }; })()""")
        good = r['shown'] and r['hintTop'] >= r['panelBottom']
        if not good: bad.append((vp, r))
        print(vp, 'ok' if good else 'BAD', json.dumps(r)); ctx.close()
    b.close()
print('hint pos:', 'all ok' if not bad else bad)
