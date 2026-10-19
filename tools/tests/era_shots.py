"""Screenshot every era mid-run with real WebGL (SwiftShader). usage: era_shots.py HTML OUTDIR [W H] [ERAS] [Z]"""
import sys, os, json
from playwright.sync_api import sync_playwright
HTML, OUT = sys.argv[1], sys.argv[2]
W = int(sys.argv[3]) if len(sys.argv) > 3 else 1280; H = int(sys.argv[4]) if len(sys.argv) > 4 else 720
ERAS = [int(x) for x in sys.argv[5].split(',')] if len(sys.argv) > 5 else list(range(9))
Z0 = float(sys.argv[6]) if len(sys.argv) > 6 else 140
os.makedirs(OUT, exist_ok=True)
S = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
THREE = open(os.path.join(S, '..', 'vendor', 'three.min.js')).read()
errs = []
def until(page, js, n=3000):
    for i in range(n):
        if page.evaluate(js): return True
        page.wait_for_timeout(100)
    return False
def game_wait(page, sec):
    t0 = page.evaluate('__torch.G.run.runTime'); until(page, f'__torch.G.run.runTime >= {t0 + sec}')
with sync_playwright() as pw:
    b = pw.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    page = b.new_context(viewport={'width': W, 'height': H}, locale=os.environ.get('LOC', 'ja-JP')).new_page()
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.on('console', lambda m: m.type == 'error' and errs.append('console: ' + m.text))
    page.route('**/three.min.js', lambda r: r.fulfill(status=200, content_type='application/javascript', body=THREE))
    page.route('https://fonts.**', lambda r: r.abort())
    page.goto('file://' + HTML); page.wait_for_function('window.__torch && __torch.G && __torch.G.save'); page.wait_for_timeout(1200)
    ev = page.evaluate
    ev("__torch.G.save.tutorialDone = true; __torch.G.save.itemTips = 9; __torch.G.save.settings.shake = false; __torch.G.save.settings.chotto = false; __torch.G.save.settings.music = false; void 0")
    for era in ERAS:
        ev(f"__torch.G.save.settings.era = {era}; __torch.G.save.settings.shortCourse = false; void 0")
        ev("__torch.startRun()")
        until(page, "__torch.G.state === 'running'", 900)
        page.keyboard.down('Space')
        info = ev("""(z0 => { const G = __torch.G, T = __torch.T, c = G.run.course; G.run.smashed.fill(0);
          const ok = (z) => { const i0 = T.segIndexAt(c.segs, z); if (i0 < 0) return false; for (let d = -10; d <= 6; d += 0.5) { const i = T.segIndexAt(c.segs, z + d); if (i < 0 || c.segs[i].y !== c.segs[i0].y) return false; } return true; };
          let z = z0; while (!ok(z) && z < c.L - 30) z += 1;
          const cps = c.checkpoints; let k = 0; while (k + 1 < cps.length && cps[k + 1] <= z) k++;
          const s = T.supportAt(c, z, 50), y = s ? s.y : 0, r = G.run;
          Object.assign(r.p, { z, prevZ: z, x: 0, prevX: 0, y, prevY: y, vy: 0, vz: 9, grounded: true }); r.lastSafe = { x: 0, y, z }; r.cp = k; r.momentum = 2; r.stamina = 100; r.flame = 95;
          if (__torch.snapCamera) __torch.snapCamera();
          return { era: c.era, z, L: c.L }; })(""" + str(Z0) + ")")
        game_wait(page, 1.2)
        page.screenshot(path=os.path.join(OUT, 'era%d.png' % (era + 1)), timeout=180000)
        page.keyboard.up('Space')
        print('shot', era + 1, info, ev("({ st: __torch.G.state, z: +__torch.G.run.p.z.toFixed(1), res: __torch.G.run.result || null })"), flush=True)
        ev("__torch.goTitle()"); page.wait_for_timeout(300)
    b.close()
print('errors', errs[:8])
