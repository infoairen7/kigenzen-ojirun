import sys, os
from playwright.sync_api import sync_playwright
HTML, OUT, ERAS = sys.argv[1], sys.argv[2], [int(x) for x in sys.argv[3].split(',')]
S = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
THREE = open(os.path.join(S, '..', 'vendor', 'three.min.js')).read(); errs = []
with sync_playwright() as pw:
    b = pw.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    page = b.new_context(viewport={'width': 1280, 'height': 720}, locale='ja-JP').new_page()
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.route('**/three.min.js', lambda r: r.fulfill(status=200, content_type='application/javascript', body=THREE))
    page.route('https://fonts.**', lambda r: r.abort())
    page.goto('file://' + HTML, timeout=120000); page.wait_for_function('window.__torch && __torch.G && __torch.G.save'); page.wait_for_timeout(2000)
    for e in ERAS:
        page.evaluate(f"__torch.G.save.settings.era = {e}; __torch.goTitle(); void 0"); page.wait_for_timeout(3500)
        page.screenshot(path=f'{OUT}/title_era{e+1}.png', timeout=180000)
    b.close()
print('errors', errs[:5])
