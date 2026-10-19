"""Store screenshots (1280x720) and an itch.io cover (630x500) from the release build, rendered with real WebGL."""
import sys, os
from playwright.sync_api import sync_playwright
LOCALE = __import__('os').environ.get('TORCH_LOCALE', 'ja-JP')
HTML, OUT = sys.argv[1], sys.argv[2]; os.makedirs(OUT, exist_ok=True)
THREE = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'vendor', 'three.min.js')).read()
errs = []
def open_page(b, w, h):
    page = b.new_context(viewport={'width': w, 'height': h}, locale=LOCALE).new_page()
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.route('**/three.min.js', lambda r: r.fulfill(status=200, content_type='application/javascript', body=THREE))
    page.route('https://fonts.googleapis.com/**', lambda r: r.abort()); page.route('https://fonts.gstatic.com/**', lambda r: r.abort())
    page.goto('file://' + HTML); page.wait_for_timeout(2500)
    page.wait_for_function('window.__torch && __torch.G && __torch.G.save'); page.evaluate("__torch.G.save.settings.runMode = 'hold'; __torch.G.save.itemTips = 9")   # store shots use the default (hold to run)
    page.evaluate("__torch.G.save.tutorialDone = true")
    return page
def until(page, js, n=600):
    for i in range(n):
        if page.evaluate(js): return True
        page.wait_for_timeout(100)
    return False
def game_wait(page, sec):   # SwiftShader runs slower than real time, so wait on the game clock, not the wall clock
    t0 = page.evaluate('__torch.G.run.runTime'); until(page, f'__torch.G.run.runTime >= {t0 + sec}')
def to_running(page):
    for i in range(600):
        page.wait_for_timeout(100)
        if page.evaluate('__torch.G.state') == 'running': return
with sync_playwright() as pw:
    b = pw.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    page = open_page(b, 1280, 720)
    page.screenshot(path=f'{OUT}/01_title.png')
    page.click('#len-short'); page.click('#mode-race'); page.click('#btn-start'); page.wait_for_timeout(500)
    page.screenshot(path=f'{OUT}/02_start.png')
    to_running(page)
    page.evaluate("__torch.G.run.smashed.fill(1)")   # a clean straight for the speed shot
    page.keyboard.down('Space'); until(page, '__torch.G.run.runTime >= 1.6', 3000)
    page.evaluate("__torch.G.run.momentum = 2.5")   # skip the build-up (SwiftShader is slow): the shot is about full speed
    until(page, '__torch.G.run.top === true', 3000)
    # spread the pack out just ahead, so the shot shows the player closing in on them at full speed
    SPREAD = """(()=>{ const G=__torch.G, T=__torch.T, r=G.run; G.npcs.forEach((n,i)=>{ const p=n.run.p, z=r.p.z + [3.2,5.6,8.2,10.8,13.6][i], s=T.supportAt(r.course, z, 50), y=s?s.y:0;
      Object.assign(p, { z, prevZ: z, x: [-0.95,0.95,-0.35,0.6,-0.8][i], y, prevY: y, vy: 0, vz: 9.6, grounded: true }); p.prevX = p.x; n.run.cp = r.cp; if (n.run.smashed) n.run.smashed.fill(1); }); })()"""
    page.evaluate(SPREAD)
    game_wait(page, 0.7)
    page.screenshot(path=f'{OUT}/03_race.png')
    page.evaluate("(()=>{ const r=__torch.G.run; r.buffs.wig = 12; r.wigStyle='afro'; __torch.wearWig('afro'); })()")
    page.evaluate(SPREAD.replace('[3.2,5.6,8.2,10.8,13.6]', '[4.5,7,9.5,12,15]'))   # keep the pack clear of the camera
    game_wait(page, 1.2)
    page.screenshot(path=f'{OUT}/04_wig.png')
    # mischief item: blow the conch with two rivals right alongside
    page.evaluate("(()=>{ const r=__torch.G.run; r.buffs.wig = 0; __torch.dropWig(); })()")
    game_wait(page, 0.4)
    # a clear stretch (past the log at 56 m, before the gate at 100 m); retry until the conch really lands
    for attempt in range(4):
        h0 = page.evaluate("__torch.G.ch ? __torch.G.ch.hits : 0")
        page.evaluate("(()=>{ const r=__torch.G.run, p=r.p; Object.assign(p, { z: 64, prevZ: 64, x: -1.05, prevX: -1.05 }); r.lastSafe = { x: -1.05, y: p.y, z: 64 }; if (__torch.snapCamera) __torch.snapCamera(); const C=__torch.G.ch; if (C) { C.mine='conch'; C.rollT=0; } })()")
        game_wait(page, 0.2)
        page.evaluate("(()=>{ const r=__torch.G.run, p=r.p; Object.assign(p, { z: 64, prevZ: 64, x: -1.05, prevX: -1.05 }); })()")
        page.evaluate(SPREAD.replace('[3.2,5.6,8.2,10.8,13.6]', '[2.5,5.8,10,13,16]').replace('[-0.95,0.95,-0.35,0.6,-0.8]', '[0.8,0.15,0.3,-0.5,0.6]').replace('vz: 9.6', 'vz: r.p.vz'))
        page.keyboard.press('KeyE'); game_wait(page, 0.12)
        if page.evaluate("__torch.G.ch ? __torch.G.ch.hits : 0") > h0: break
        print('conch missed, retrying', attempt, flush=True)
    page.screenshot(path=f'{OUT}/06_items.png')
    if os.environ.get('ITEMS_ONLY'): b.close(); print('errors', errs[:5]); sys.exit(0)
    page.evaluate("(()=>{const G=__torch.G, r=G.run; r.buffs.wig = 0; __torch.dropWig(); r.cp=5; r.runTime = 63.2; const z = r.course.L - 6; r.p.z = z; r.p.prevZ = z; r.p.vz = 8; r.flame = 80; r.lastSafe.z = z; G.npcs.forEach((n,i)=>{ n.run.cp=5; n.run.p.z = z - 1.5 - i*1.4; n.run.p.prevZ = n.run.p.z; n.run.p.vz = 6.5; });})()")
    until(page, "__torch.G.state === 'result'"); page.wait_for_timeout(2500)
    page.screenshot(path=f'{OUT}/05_result.png')
    page.context.close()
    # cover: start grid, HUD hidden, logo overlaid
    page = open_page(b, 630, 500)
    page.click('#len-short'); page.click('#mode-race'); page.click('#btn-start'); page.wait_for_timeout(300)
    to_running(page); page.wait_for_timeout(300)
    page.add_style_tag(content='#hud, .npc-tag, #npc-tags, #ready, #bubble, #hint, #toast, .countdown, #touch { display:none !important }')
    page.evaluate(("""(()=>{ const KICK=%s, LOGO=%s; const d=document.createElement('div'); d.style.cssText='position:fixed;left:0;right:0;top:22px;text-align:center;z-index:50;font-family:var(--font-ui);pointer-events:none';
      d.innerHTML='<div style="font:700 15px var(--font-num);letter-spacing:.12em;color:#ffc35a;text-shadow:0 2px 10px #000">' + KICK + '</div><div style="font-weight:900;font-size:58px;line-height:1.05;color:#fff4e2;text-shadow:0 4px 0 #6a2c1a,0 8px 24px rgba(0,0,0,.6)">' + LOGO + '</div>';
      document.body.appendChild(d); })()""") % (("'10,000 BC — A SIX-OJISAN RACE'", "'Kigenzen Ojirun!'") if LOCALE.startswith('en') else ("'BC10,000 — 6人のおじさんレース'", "'紀元前おじラン！'")))
    page.wait_for_timeout(300); page.screenshot(path=f'{OUT}/cover_630x500.png')
    b.close()
print('errors', errs[:5])
