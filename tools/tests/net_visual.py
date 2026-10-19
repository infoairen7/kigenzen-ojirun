"""Real-WebGL look at the online lobby, a race with another player, and the result. usage: net_visual.py HTML SERVER_DIR OUTDIR [W H LOC]"""
import sys, os, subprocess, random, json
from playwright.sync_api import sync_playwright
HTML, SRV, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
W = int(sys.argv[4]) if len(sys.argv) > 4 else 1280; H = int(sys.argv[5]) if len(sys.argv) > 5 else 720; LOC = sys.argv[6] if len(sys.argv) > 6 else 'ja-JP'
os.makedirs(OUT, exist_ok=True)
T = os.path.dirname(os.path.abspath(__file__)); STUB = open(os.path.join(T, 'three_stub.js')).read(); THREE = open(os.path.join(T, '..', '..', 'vendor', 'three.min.js')).read()
PORT = 19900 + random.randint(0, 90)
srv = subprocess.Popen(['node', os.path.join(SRV, 'dev', 'local-server.mjs'), '--port', str(PORT), '--host', '127.0.0.1'], stdout=subprocess.PIPE, text=True)
while 'online server' not in srv.stdout.readline(): pass
URL = 'file://' + HTML + '?server=ws://127.0.0.1:' + str(PORT)
errs = []
def until(pg, js, n=600, step=100):
    for i in range(n):
        if pg.evaluate(js): return True
        pg.wait_for_timeout(step)
    return False
with sync_playwright() as pw:
    gl = pw.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    st = pw.chromium.launch()
    def page(br, three, w, h, loc, name):
        pg = br.new_context(viewport={'width': w, 'height': h}, locale=loc).new_page()
        pg.on('pageerror', lambda e: errs.append(name + ': ' + str(e)))
        pg.route('**/three.min.js', lambda r: r.fulfill(status=200, content_type='application/javascript', body=three))
        pg.route('https://fonts.**', lambda r: r.abort())
        pg.goto(URL, timeout=120000); pg.wait_for_function('window.__torch && __torch.G && __torch.G.save', timeout=120000); pg.wait_for_timeout(1500)
        pg.evaluate("__torch.G.save.tutorialDone = true; __torch.G.save.itemTips = 9; __torch.G.save.settings.music = false; __torch.G.save.settings.shake = false; void 0")
        return pg
    A = page(gl, THREE, W, H, LOC, 'A')
    B = page(st, STUB, 1280, 720, 'ja-JP', 'B'); C = page(st, STUB, 1280, 720, 'ja-JP', 'C')
    A.evaluate("__torch.G.save.settings.nick = %s; void 0" % json.dumps('あきら' if LOC.startswith('ja') else 'Akira'))
    A.click('#btn-online'); A.wait_for_timeout(1500); A.screenshot(path=OUT + '/online_join.png', timeout=180000)
    A.click('#on-create'); until(A, "!!__torch.NET.code")
    code = A.evaluate("__torch.NET.code")
    for pg, nm in (((B, 'ベン'), (C, 'カズ')) if LOC.startswith('ja') else ((B, 'Ben'), (C, 'Kaz'))):
        pg.evaluate("__torch.G.save.settings.nick = %s; void 0" % json.dumps(nm)); pg.click('#btn-online'); pg.fill('#on-code', code); pg.click('#on-joinbtn'); until(pg, "!!__torch.NET.code")
    until(A, "__torch.NET.players.length === 3")
    A.select_option('#on-era', '6'); until(A, "__torch.G.course.era === 6", 100); A.wait_for_timeout(2500)
    A.screenshot(path=OUT + '/online_room.png', timeout=180000)
    A.click('#on-start')
    until(A, "__torch.G.state === 'running'"); until(B, "__torch.G.state === 'running'")
    for pg in (A, B, C): pg.keyboard.down('Space')
    until(A, "__torch.G.run.runTime > 4", 900)
    # bring the other two just ahead of the host so they are in shot
    za = A.evaluate("__torch.G.run.p.z")
    B.evaluate("(z => { const r = __torch.G.run, T = __torch.T, s = T.supportAt(r.course, z, 50); Object.assign(r.p, { z, prevZ: z, x: 1.2, prevX: 1.2, y: s ? s.y : 0, prevY: s ? s.y : 0 }); })(%f)" % (za + 5))
    C.evaluate("(z => { const r = __torch.G.run, T = __torch.T, s = T.supportAt(r.course, z, 50); Object.assign(r.p, { z, prevZ: z, x: -1.3, prevX: -1.3, y: s ? s.y : 0, prevY: s ? s.y : 0 }); })(%f)" % (za + 9))
    B.keyboard.up('Space'); C.keyboard.up('Space')
    A.evaluate('__torch.NET.race.startLocal = performance.now() - __torch.G.run.runTime * 1000; 0')   # SwiftShader runs slower than real time: show the race clock the run would have on a real machine
    A.wait_for_timeout(1200)
    A.screenshot(path=OUT + '/online_race.png', timeout=180000)
    print('race', A.evaluate("__torch.G.npcs.map(n => [n.name, +(n.run.p.z - __torch.G.run.p.z).toFixed(1), n.human])"), flush=True)
    A.evaluate("(()=>{const r=__torch.G.run; r.cp=r.course.checkpoints.length-1; r.p.z = r.course.L - 0.5; r.p.prevZ = r.p.z; r.p.vz = 8; r.flame = 50;})()")
    until(A, "__torch.G.state === 'result'", 600); A.wait_for_timeout(2500)
    A.screenshot(path=OUT + '/online_result.png', timeout=180000)
    gl.close(); st.close()
srv.kill()
print('errors', errs[:5])
