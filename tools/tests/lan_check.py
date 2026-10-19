import sys, os, subprocess
from playwright.sync_api import sync_playwright
GAME, SRV = sys.argv[1], sys.argv[2]
STUB = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'three_stub.js')).read()
p = subprocess.Popen(['node', os.path.join(SRV, 'dev', 'local-server.mjs'), '--port', '18777', '--host', '127.0.0.1', '--game', GAME], stdout=subprocess.PIPE, text=True)
while 'online server' not in p.stdout.readline(): pass
with sync_playwright() as pw:
    b = pw.chromium.launch(); pg = b.new_page()
    pg.route('**/three.min.js', lambda r: r.fulfill(status=200, content_type='application/javascript', body=STUB))
    pg.goto('http://127.0.0.1:18777/'); pg.wait_for_function('window.__torch && __torch.G && __torch.G.save'); pg.wait_for_timeout(300)
    srv = pg.evaluate('__torch.netServer()')
    pg.evaluate('__torch.openOnline()'); pg.click('#on-create'); pg.wait_for_function('!!__torch.NET.code')
    print('LAN', srv, pg.evaluate('__torch.NET.code'), 'ok' if srv == 'ws://127.0.0.1:18777' else 'BAD')
    b.close()
p.kill()
