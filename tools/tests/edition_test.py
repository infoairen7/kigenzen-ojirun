"""The English edition starts in English even in a Japanese browser; a player's own pick still wins; the JA build still follows the browser.
Both release pages run in standards mode with a charset and a phone viewport."""
import sys, tempfile, os, json
from playwright.sync_api import sync_playwright
STUB = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'three_stub.js')).read()
EN_PAGE, JA_PAGE = sys.argv[1], sys.argv[2]
checks, out, errs = [], {}, []
def ok(n, c, v=None): checks.append((n, bool(c))); out[n] = v if v is not None else bool(c)
def load(b, path, locale, mobile=False):
    ctx = b.new_context(viewport={'width': 844, 'height': 390} if mobile else {'width': 1280, 'height': 720}, locale=locale, is_mobile=mobile, has_touch=mobile, device_scale_factor=3 if mobile else 1)
    page = ctx.new_page(); page.on('pageerror', lambda e: errs.append(str(e)))
    page.route('**/three.min.js', lambda r: r.fulfill(status=200, content_type='application/javascript', body=STUB))
    page.route('https://fonts.**', lambda r: r.abort())
    page.goto('file://' + path); page.wait_for_function('window.__torch && __torch.G && __torch.G.save'); page.wait_for_timeout(400)
    return ctx, page
with sync_playwright() as pw:
    b = pw.chromium.launch()
    ctx, page = load(b, EN_PAGE, 'ja-JP')
    r = page.evaluate("({ lang: document.documentElement.lang, title: document.title, mode: document.compatMode, cs: document.characterSet, logo: document.querySelector('.logo').textContent, start: document.getElementById('btn-start').innerText.split('\\n')[0] })")
    ok('en_edition_in_ja_browser', r['lang'] == 'en' and r['logo'].startswith('Kigenzen') and r['title'].startswith('Kigenzen') and r['start'].startswith('Start'), r)
    ok('standards_mode_utf8', r['mode'] == 'CSS1Compat' and r['cs'] == 'UTF-8', r)
    page.click('#lang-ja'); page.wait_for_timeout(200); page.reload(); page.wait_for_function('window.__torch && __torch.G && __torch.G.save'); page.wait_for_timeout(300)
    ok('own_pick_wins', page.evaluate("document.documentElement.lang") == 'ja' and 'おじ' in page.evaluate("document.querySelector('.logo').textContent"))
    ctx.close()
    ctx, page = load(b, JA_PAGE, 'ja-JP')
    r = page.evaluate("({ lang: document.documentElement.lang, mode: document.compatMode, logo: document.querySelector('.logo').textContent })")
    ok('ja_build_follows_browser_ja', r['lang'] == 'ja' and 'おじ' in r['logo'] and r['mode'] == 'CSS1Compat', r); ctx.close()
    ctx, page = load(b, JA_PAGE, 'en-US')
    ok('ja_build_follows_browser_en', page.evaluate("document.documentElement.lang") == 'en'); ctx.close()
    # a phone: the viewport meta makes the page lay out at the device width, not a zoomed-out 980 px
    ctx, page = load(b, EN_PAGE, 'en-US', mobile=True)
    r = page.evaluate("({ iw: innerWidth, ih: innerHeight, sw: document.documentElement.scrollWidth, tools: (() => { const t = document.querySelector('.title-tools').getBoundingClientRect(); return [Math.round(t.left), Math.round(t.right)]; })(), col: Math.round(document.querySelector('.title-col').getBoundingClientRect().right) })")
    ok('phone_viewport', r['iw'] == 844 and r['sw'] <= 844 and r['tools'][1] <= 844, r)
    page.screenshot(path=os.path.join(tempfile.gettempdir(), 'phone_title_stub.png'))
    ctx.close(); b.close()
print(json.dumps(out, ensure_ascii=False, indent=1))
print('edition checks:', sum(1 for _, c in checks if c), '/', len(checks), [n for n, c in checks if not c]); print('errors', errs[:5])
