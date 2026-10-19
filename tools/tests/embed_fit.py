"""The title screen and HUD fit the itch.io embed sizes (no scrolling, nothing past the edges), JA and EN."""
import sys, os, json
from playwright.sync_api import sync_playwright
STUB = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'three_stub.js')).read(); PAGE = sys.argv[1]; SHOTDIR = sys.argv[2] if len(sys.argv) > 2 else None; bad = []
with sync_playwright() as pw:
    b = pw.chromium.launch()
    for loc in ('en-US', 'ja-JP'):
        for vp in ((960, 540), (1280, 720), (1024, 576), (800, 450)):
            ctx = b.new_context(viewport={'width': vp[0], 'height': vp[1]}, locale=loc); page = ctx.new_page()
            page.route('**/three.min.js', lambda r: r.fulfill(status=200, content_type='application/javascript', body=STUB)); page.route('https://fonts.**', lambda r: r.abort())
            page.goto('file://' + PAGE); page.wait_for_function('window.__torch && __torch.G && __torch.G.save'); page.wait_for_timeout(300)
            page.evaluate("document.getElementById('%s').click()" % ('lang-en' if loc == 'en-US' else 'lang-ja')); page.wait_for_timeout(200)
            r = page.evaluate("""(() => { const sc = document.getElementById('scr-title'), col = document.querySelector('.title-col').getBoundingClientRect(), t = document.querySelector('.title-tools').getBoundingClientRect(), k = document.querySelector('.kicker').getBoundingClientRect();
              return { overflow: sc.scrollHeight - sc.clientHeight, colBottom: Math.round(col.bottom), colRight: Math.round(col.right), toolsLeft: Math.round(t.left), toolsBottom: Math.round(t.bottom), kickerTop: Math.round(k.top) }; })()""")
            good = r['overflow'] <= 0 and (r['colRight'] <= r['toolsLeft'] or r['kickerTop'] >= r['toolsBottom'])
            if not good: bad.append((loc, vp, r))
            print(loc, vp, 'ok' if good else 'BAD', json.dumps(r))
            if SHOTDIR and vp == (960, 540): page.screenshot(path=os.path.join(SHOTDIR, f'embed_{loc}_960.png'))
            ctx.close()
    b.close()
print('embed fit:', 'all ok' if not bad else bad)
