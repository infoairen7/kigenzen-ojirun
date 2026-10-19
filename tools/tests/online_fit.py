"""Does the online screen fit without scrolling at itch embed and phone sizes? usage: online_fit.py HTML SERVER_DIR OUTDIR"""
import sys, os, subprocess, random
from playwright.sync_api import sync_playwright
HTML, SRV, OUT = sys.argv[1:4]; os.makedirs(OUT, exist_ok=True)
STUB = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'three_stub.js')).read()
PORT = 19950 + random.randint(0, 40)
srv = subprocess.Popen(['node', os.path.join(SRV, 'dev', 'local-server.mjs'), '--port', str(PORT), '--host', '127.0.0.1'], stdout=subprocess.PIPE, text=True)
INIT = "window.TORCH_PEER = { host: '127.0.0.1', port: %d, secure: false }; window.TORCH_ICE = [];" % PORT   # browser to browser (the default), local broker
while 'online server' not in srv.stdout.readline(): pass
res = []
with sync_playwright() as pw:
    b = pw.chromium.launch()
    for (w, h, loc, touch) in [(960, 540, 'ja-JP', False), (960, 540, 'en-US', False), (1280, 720, 'ja-JP', False), (844, 390, 'ja-JP', True), (390, 844, 'ja-JP', True), (1920, 1080, 'en-US', False)]:
        ctx = b.new_context(viewport={'width': w, 'height': h}, locale=loc, has_touch=touch, is_mobile=touch); ctx.add_init_script(INIT); pg = ctx.new_page()
        pg.route('**/three.min.js', lambda r: r.fulfill(status=200, content_type='application/javascript', body=STUB)); pg.route('https://fonts.**', lambda r: r.abort())
        pg.goto('file://' + HTML); pg.wait_for_function('window.__torch && __torch.G && __torch.G.save'); pg.wait_for_timeout(300)
        pg.evaluate("__torch.openOnline()"); pg.wait_for_timeout(200)
        fit1 = pg.evaluate("(()=>{ const s = document.querySelector('#scr-online'); return !document.querySelector('#on-noserver').hidden && s.scrollHeight <= s.clientHeight + 1 && s.scrollWidth <= s.clientWidth + 1; })()")
        pg.screenshot(path=f'{OUT}/join_{w}x{h}_{loc}.png')
        pg.evaluate("__torch.netCreate()"); pg.wait_for_function("!!__torch.NET.code"); pg.wait_for_timeout(600)
        fit2 = pg.evaluate("(()=>{ const s = document.querySelector('#scr-online'); return [s.scrollHeight, s.clientHeight, s.scrollWidth, s.clientWidth, !document.querySelector('#on-noserver').hidden]; })()")
        pg.screenshot(path=f'{OUT}/room_{w}x{h}_{loc}.png')
        tfit = pg.evaluate("(()=>{ __torch.netLeave(); __torch.goTitle(); const s = document.querySelector('#scr-title'); return s.scrollHeight <= s.clientHeight + 1; })()")
        res.append(((w, h, loc), fit1, fit2[0] <= fit2[1] + 1 and fit2[2] <= fit2[3] + 1, fit2, tfit))
        ctx.close()
    b.close()
srv.kill()
for r in res: print(r)
