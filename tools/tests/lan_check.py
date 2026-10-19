"""Home-network play: local-server.mjs --game serves the game pointed at itself, as a relay server and (--p2p) as the broker.
usage: lan_check.py HTML SERVER_DIR"""
import sys, os, subprocess
from playwright.sync_api import sync_playwright
GAME, SRV = sys.argv[1], sys.argv[2]
STUB = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'three_stub.js')).read()
for port, extra in ((18777, []), (18778, ['--p2p'])):
    p = subprocess.Popen(['node', os.path.join(SRV, 'dev', 'local-server.mjs'), '--port', str(port), '--host', '127.0.0.1', '--game', GAME] + extra, stdout=subprocess.PIPE, text=True)
    while 'online server' not in p.stdout.readline(): pass
    with sync_playwright() as pw:
        b = pw.chromium.launch(); pg = b.new_page()
        pg.route('**/three.min.js', lambda r: r.fulfill(status=200, content_type='application/javascript', body=STUB))
        pg.goto('http://127.0.0.1:%d/' % port); pg.wait_for_function('window.__torch && __torch.G && __torch.G.save'); pg.wait_for_timeout(300)
        mode, srv = pg.evaluate('__torch.netMode()'), pg.evaluate('__torch.netServer()')
        pg.evaluate('__torch.openOnline()'); pg.click('#on-create'); pg.wait_for_function('!!__torch.NET.code', timeout=20000)
        good = (mode == 'server' and srv == 'ws://127.0.0.1:%d' % port) if not extra else (mode == 'p2p' and pg.evaluate('__torch.NET.ws.isHost'))
        print('LAN', mode, srv or '-', pg.evaluate('__torch.NET.code'), 'ok' if good else 'BAD')
        b.close()
    p.kill()
