"""v14: hold to run (default), top gear, the distance HUD, mash mode still works, and running without bonfire breaks."""
import sys, os, json
from playwright.sync_api import sync_playwright
LOCALE = os.environ.get('TORCH_LOCALE', 'ja-JP')
HTML = sys.argv[1]
STUB = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'three_stub.js')).read()
out, checks, errs = {}, [], []
def ok(name, cond, val=None): checks.append((name, bool(cond))); out[name] = val if val is not None else bool(cond)
def until(page, js, n=150):
    for i in range(n):
        if page.evaluate(js): return True
        page.wait_for_timeout(100)
    return False
TP = "void (window.tp = (z) => { const r = __torch.G.run, T = __torch.T, cps = r.course.checkpoints; let i = 0; while (i + 1 < cps.length && cps[i + 1] <= z) i++; r.cp = i; r.secStartT = r.runTime; const s = T.supportAt(r.course, z, 50), y = s ? s.y : 0; Object.assign(r.p, { z, prevZ: z, x: 0, prevX: 0, y, prevY: y, vy: 0, grounded: true }); r.lastSafe = { x: 0, y, z }; })"
with sync_playwright() as pw:
    b = pw.chromium.launch()
    page = b.new_context(viewport={'width': 1280, 'height': 720}, locale=LOCALE).new_page()
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.route('**/three.min.js', lambda r: r.fulfill(status=200, content_type='application/javascript', body=STUB))
    page.route('https://fonts.**', lambda r: r.abort())
    page.goto('file://' + HTML); page.wait_for_function('window.__torch && __torch.G && __torch.G.save'); page.wait_for_timeout(500)
    ev = page.evaluate; ev(TP); ev("__torch.G.save.tutorialDone = true; __torch.G.save.settings.chotto = false")
    ok('default_hold', ev("__torch.G.save.settings.runMode") == 'hold')
    ok('title_keys_hold', '長押し' in ev("document.getElementById('title-keys').textContent") or 'hold' in ev("document.getElementById('title-keys').textContent"))
    # breaks option on the title
    page.click('#brk-off'); ok('breaks_off_saved', ev("__torch.G.save.settings.breaks") is False and ('休憩なし' in ev("document.getElementById('start-sub').textContent") or 'no breaks' in ev("document.getElementById('start-sub').textContent")))
    page.click('#brk-on'); ok('breaks_on_saved', ev("__torch.G.save.settings.breaks") is True)
    page.click('#len-short'); page.click('#mode-solo'); page.click('#btn-start')
    ok('ready_hold_prompt', '長押し' in ev("document.getElementById('ready-sub').textContent") or 'Hold' in ev("document.getElementById('ready-sub').textContent"), ev("document.getElementById('ready-sub').textContent"))
    until(page, "__torch.G.state === 'running'")
    ev("__torch.G.run.smashed.fill(1)")   # these checks are about running speed, not jumping: clear the logs out of the way
    page.keyboard.down('Space'); page.wait_for_timeout(2500)
    v = ev("__torch.G.run.p.vz"); ok('hold_runs', v > 8.5, round(v, 2))
    ok('hud_distance', ev("document.getElementById('t-taps-k').textContent") in ('距離', 'DIST') and ev("document.getElementById('t-taps').textContent").endswith(' m'), ev("document.getElementById('t-taps').textContent"))
    ok('kmh', int(ev("document.getElementById('spd').textContent")) >= 30, ev("document.getElementById('spd').textContent"))
    until(page, "__torch.G.run.top === true", 200)
    r = ev("({ top: __torch.G.run.top, vz: __torch.G.run.p.vz, badge: !document.getElementById(\"top-badge\").hidden, mom: __torch.G.run.momentum, sta: __torch.G.run.stamina, z: __torch.G.run.p.z, st: __torch.G.state, stumble: __torch.G.run.stumble, t: __torch.G.run.runTime })")
    ok('top_gear', r['top'] and r['vz'] > 10.5 and r['badge'], r)
    # move to a stretch with no logs or gaps ahead, so the coast is not cut short by tripping over something
    out['coast_z'] = ev("(() => { const c = __torch.G.run.course, os = c.obstacles || []; for (let z = Math.ceil(__torch.G.run.p.z); z < 88; z++) { if (!os.some(o => o.z > z - 1 && o.z < z + 18) && [0, 4, 8, 12, 16].every(d => __torch.T.supportAt(c, z + d, 50))) { tp(z); return z; } } return -1; })()")
    page.keyboard.up('Space'); until(page, "!__torch.Input.held", 20); page.wait_for_timeout(300)
    t0 = ev("__torch.G.run.stats.taps"); page.wait_for_timeout(600); t1 = ev("__torch.G.run.stats.taps")
    r = ev("({ vz: __torch.G.run.p.vz, mom: __torch.G.run.momentum })")
    ok('release_coasts', t1 == t0 and r['vz'] > 9.5 and r['mom'] > 0, dict(r, taps=[t0, t1]))
    # a single quick press in hold mode does not count as mashing
    # bonfire gate with breaks on → the rest screen
    page.keyboard.down('Space'); ev("tp(97)"); until(page, "__torch.G.state === 'break'", 80)
    ok('gate_breaks_on', ev("__torch.G.state") == 'break')
    page.keyboard.up('Space'); page.wait_for_timeout(1300)
    page.keyboard.down('Space'); until(page, "__torch.G.state !== 'break'", 40); page.keyboard.up('Space')
    until(page, "__torch.G.state === 'running'", 60)
    # breaks off → a banner, keep running, stamina full
    ev("__torch.G.save.settings.breaks = false; __torch.G.run.stamina = 30")
    page.keyboard.down('Space'); ev("tp(196)"); until(page, "__torch.G.run.cp >= 2", 80); page.wait_for_timeout(200)
    r = ev("({ st: __torch.G.state, banner: !document.getElementById('gate').hidden, k: document.getElementById('gate-k').textContent, stamina: __torch.G.run.stamina })")
    ok('gate_breaks_off', r['st'] == 'running' and r['banner'] and r['stamina'] > 95, r)
    page.keyboard.up('Space')
    # finish → result shows the distance
    ev("(() => { const r = __torch.G.run; r.cp = r.course.checkpoints.length - 1; tp(r.course.L - 4); })()")
    page.keyboard.down('Space'); until(page, "__torch.G.state === 'result'", 120); page.keyboard.up('Space'); page.wait_for_timeout(300)
    grid = ev("document.getElementById('r-grid').innerText"); note = ev("document.getElementById('r-note').textContent")
    ok('result_distance', ('走行距離' in grid or 'Distance' in grid) and 'km/h' in grid and ('m 走りました' in note or 'You ran' in note), grid.replace('\n', ' | ')[:160])
    # mash mode via settings: single presses move you again
    ev("__torch.goTitle()"); page.wait_for_timeout(300)
    page.click('#btn-settings'); page.wait_for_timeout(200); page.click('#s-run')
    ok('mash_toggle', ev("__torch.G.save.settings.runMode") == 'mash' and ev("document.getElementById('s-run').textContent") in ('連打', 'Mash'))
    page.click('#s-done'); page.wait_for_timeout(300)
    ok('title_keys_mash', '連打' in ev("document.getElementById('title-keys').textContent") or 'mash' in ev("document.getElementById('title-keys').textContent"))
    page.click('#btn-start'); until(page, "__torch.G.state === 'running'")
    for i in range(14): page.keyboard.press('Space'); page.wait_for_timeout(110)
    r = ev("({ taps: __torch.G.run.stats.taps, z: __torch.G.run.p.z, k: document.getElementById('t-taps-k').textContent })")
    ok('mash_mode_taps', r['taps'] >= 12 and r['z'] > 4 and r['k'] in ('連打', 'TAPS'), r)
    page.keyboard.down('Space'); page.wait_for_timeout(1000); tz = ev("__torch.G.run.stats.taps"); page.keyboard.up('Space')
    ok('mash_hold_does_not_run', tz <= r['taps'] + 1, tz)
    ev("__torch.G.save.settings.runMode = 'hold'; __torch.G.save.settings.breaks = true")
    b.close()
print(json.dumps(out, ensure_ascii=False, indent=1))
print('hold checks:', sum(1 for _, c in checks if c), '/', len(checks), [n for n, c in checks if not c])
print('errors', errs[:5])
