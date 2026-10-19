"""On a short landscape phone the title fits without scrolling (JA and EN), and the title tools don't overlap the column."""
import sys, tempfile, os, json
from playwright.sync_api import sync_playwright
STUB = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'three_stub.js')).read(); PAGE = sys.argv[1]; bad = []
with sync_playwright() as pw:
    b = pw.chromium.launch()
    for loc in ('ja-JP', 'en-US'):
        for vp in ((844, 390), (740, 360), (932, 430), (667, 375)):
            ctx = b.new_context(viewport={'width': vp[0], 'height': vp[1]}, locale=loc, is_mobile=True, has_touch=True, device_scale_factor=2); page = ctx.new_page()
            page.route('**/three.min.js', lambda r: r.fulfill(status=200, content_type='application/javascript', body=STUB)); page.route('https://fonts.**', lambda r: r.abort())
            page.goto('file://' + PAGE); page.wait_for_function('window.__torch && __torch.G && __torch.G.save'); page.wait_for_timeout(300)
            if loc == 'ja-JP': page.evaluate("document.getElementById('lang-ja').click()")
            else: page.evaluate("document.getElementById('lang-en').click()")
            page.wait_for_timeout(200)
            r = page.evaluate("""(() => { const sc = document.getElementById('scr-title'), col = document.querySelector('.title-col').getBoundingClientRect(), t = document.querySelector('.title-tools').getBoundingClientRect();
              const k = document.querySelector('.kicker').getBoundingClientRect();
              return { overflow: sc.scrollHeight - sc.clientHeight, colBottom: Math.round(col.bottom), colRight: Math.round(col.right), toolsLeft: Math.round(t.left), toolsBottom: Math.round(t.bottom), kickerTop: Math.round(k.top), kickerRight: Math.round(k.right) }; })()""")
            good = r['overflow'] <= 0 and (r['colRight'] <= r['toolsLeft'] or r['kickerTop'] >= r['toolsBottom'])
            if not good: bad.append((loc, vp, r))
            print(loc, vp, 'ok' if good else 'BAD', json.dumps(r))
            if vp == (844, 390): page.screenshot(path=os.path.join(tempfile.gettempdir(), f'phone_fit_{loc}.png'))
            ctx.close()
    b.close()
print('phone fit:', 'all ok' if not bad else bad)
