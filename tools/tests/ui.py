"""Headless UI flow regression (three.js replaced by a no-op proxy; WebGL output is not checked here)."""
import sys, json, os
from playwright.sync_api import sync_playwright
LOCALE = __import__('os').environ.get('TORCH_LOCALE', 'ja-JP')
HTML = sys.argv[1]; OUT = sys.argv[2]
STUB = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'three_stub.js')).read()
errors = []
log = {}
with sync_playwright() as pw:
    b = pw.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])

    def open_page(w, h, tag, mobile=False):
        ctx = b.new_context(viewport={'width': w, 'height': h}, has_touch=mobile, is_mobile=mobile, locale=LOCALE)
        page = ctx.new_page()
        page.on('console', lambda m: errors.append(f'[{tag}] console.{m.type}: {m.text}') if m.type in ('error', 'warning') and 'ERR_FAILED' not in m.text else None)
        page.on('pageerror', lambda e: errors.append(f'[{tag}] pageerror: {e}'))
        page.route('**/three.min.js', lambda r: r.fulfill(status=200, content_type='application/javascript', body=STUB))
        page.route('https://fonts.googleapis.com/**', lambda r: r.abort())
        page.route('https://fonts.gstatic.com/**', lambda r: r.abort())
        page.goto('file://' + HTML)
        page.wait_for_function('window.__torch && __torch.G && __torch.G.save'); page.evaluate("__torch.G.save.settings.runMode = 'mash'")   # MASH_MODE: these checks press keys one tap at a time
        page.wait_for_timeout(600)
        return page, ctx

    page, ctx = open_page(1280, 720, 'pc')
    vis = lambda sel: page.evaluate(f"!document.querySelector('{sel}').hidden")
    log['title_visible'] = vis('#scr-title')
    page.screenshot(path=f'{OUT}/ui_title_1280.png')
    page.click('#btn-era'); page.wait_for_timeout(150); log['era_cards'] = page.evaluate("document.querySelectorAll('#era-grid .era-card').length")
    page.click('#era-back'); page.wait_for_timeout(100)
    page.click('#btn-settings'); page.wait_for_timeout(100); page.click('#s-safe'); log['safezone_in_settings'] = vis('#safezone')
    page.screenshot(path=f'{OUT}/ui_settings_1280.png')
    page.click('#s-safe'); page.click('#s-done'); page.wait_for_timeout(100); log['safezone_after'] = vis('#safezone')
    page.click('#len-short'); page.click('#mode-solo'); page.wait_for_timeout(100)
    page.click('#btn-start'); page.wait_for_timeout(100)
    log['state_after_start'] = page.evaluate('__torch.G.state')
    page.keyboard.press('Space'); page.wait_for_timeout(900)
    log['taps_during_ready'] = page.evaluate('__torch.G.run.stats.taps')
    for i in range(30):
        page.keyboard.press('Space'); page.wait_for_timeout(110)
    page.keyboard.down('Space'); page.wait_for_timeout(600); page.keyboard.up('Space')
    log['taps_after_30_and_hold'] = page.evaluate('__torch.G.run.stats.taps')
    log['z_after'] = round(page.evaluate('__torch.G.run.p.z'), 1)
    log['prog_text'] = page.inner_text('#prog-m')
    page.screenshot(path=f'{OUT}/ui_hud_1280.png')
    page.keyboard.press('Escape'); page.wait_for_timeout(150); log['paused'] = page.evaluate('__torch.G.state')
    zp = page.evaluate('__torch.G.run.p.z'); page.wait_for_timeout(500)
    log['pause_freezes'] = page.evaluate('__torch.G.run.p.z') == zp
    page.click('#p-resume'); page.wait_for_timeout(1000); log['resumed'] = page.evaluate('__torch.G.state')
    page.evaluate('__torch.G.run.flame = 0.05'); page.wait_for_timeout(2000)
    log['result_state'] = page.evaluate('__torch.G.state'); log['result_head'] = page.inner_text('#r-head')
    for i in range(6): page.keyboard.press('Space'); page.wait_for_timeout(40)
    log['state_after_mash_on_result'] = page.evaluate('__torch.G.state')
    page.wait_for_timeout(900)
    page.click('#r-image'); page.wait_for_timeout(300); log['image_modal'] = vis('#modal-image')
    page.click('#mi-close'); page.wait_for_timeout(100)
    page.click('#r-retry'); page.wait_for_timeout(200); log['retry_state'] = page.evaluate('__torch.G.state')
    page.wait_for_timeout(900)
    page.evaluate('(()=>{const r=__torch.G.run; r.cp=5; r.p.z = r.course.L - 0.5; r.p.prevZ = r.p.z; r.p.vz = 8; r.flame = 50;})()'); page.wait_for_timeout(3600)
    log['clear_state'] = page.evaluate('__torch.G.state'); log['clear_head'] = page.inner_text('#r-head')
    page.wait_for_timeout(1100)
    page.click('#r-era'); page.wait_for_timeout(150)
    page.click('#era-back'); page.wait_for_timeout(100); page.click('#btn-album'); page.wait_for_timeout(200); log['album_count'] = page.inner_text('#album-count')
    page.evaluate("localStorage.setItem('torch_ojisan_v1','{broken')"); page.reload(); page.wait_for_timeout(700)
    log['after_corrupt_reload_cards'] = page.evaluate('__torch.G.save.cards.length')
    ctx.close()

    # ---- race flow ----
    page, ctx = open_page(1280, 720, 'race')
    vis = lambda sel: page.evaluate(f"!document.querySelector('{sel}').hidden")
    page.click('#len-short'); page.click('#mode-race'); page.wait_for_timeout(100)
    page.click('#btn-start'); page.wait_for_timeout(1000)
    log['race_npcs'] = page.evaluate('__torch.G.npcs.length')
    for i in range(25):
        page.keyboard.press('Space'); page.wait_for_timeout(100)
    log['race_rank_text'] = page.inner_text('#t-rank')
    page.screenshot(path=f'{OUT}/ui_race_hud.png')
    page.evaluate('(()=>{const r=__torch.G.run; r.p.z=99.5; r.p.prevZ=99.5; r.p.vz=8;})()'); page.wait_for_timeout(300)
    log['break_state'] = page.evaluate('__torch.G.state')
    for i in range(10): page.keyboard.press('Space'); page.wait_for_timeout(60)
    log['break_after_mash'] = page.evaluate('__torch.G.state')
    page.wait_for_timeout(700)
    page.keyboard.down('Space'); page.wait_for_timeout(1000); page.keyboard.up('Space'); page.wait_for_timeout(100)
    log['after_hold'] = page.evaluate('__torch.G.state')
    page.wait_for_timeout(1000)
    page.evaluate('__torch.G.run.flame = 0.05'); page.wait_for_timeout(2300)
    log['race_death_state'] = page.evaluate('__torch.G.state')
    page.wait_for_timeout(1000)
    page.evaluate('(()=>{const r=__torch.G.run; r.cp=5; r.p.z = r.course.L - 0.5; r.p.prevZ = r.p.z; r.p.vz = 8; r.flame = 50;})()'); page.wait_for_timeout(3600)
    log['race_result_head'] = page.inner_text('#r-head')
    ctx.close()

    for (w, h, tag, mob) in [(1920, 1080, '1920', False), (844, 390, 'phone', True)]:
        page, ctx = open_page(w, h, tag, mob)
        page.evaluate('__torch.startRun()'); page.wait_for_timeout(1000)
        page.evaluate("(()=>{const r=__torch.G.run; r.buffs.shoes=2.4; r.buffs.meat=6; r.p.vz=8;})()"); page.wait_for_timeout(300)
        page.screenshot(path=f'{OUT}/ui_hud_{tag}.png')
        log['safezone_overlap_' + tag] = page.evaluate("""(()=>{const W=innerWidth,H=innerHeight; const out=[]; document.querySelectorAll('#hud .hud-panel, #hud .buff, #hud .hint, #hud .toast').forEach(e=>{ if(e.offsetParent===null) return; const r=e.getBoundingClientRect(); if(r.right>W*0.7292 && r.bottom>H*0.463) out.push(e.className); }); return out; })()""")
        ctx.close()
    b.close()

expect = {
    'title_visible': True, 'era_cards': 9, 'safezone_in_settings': True, 'safezone_after': False, 'state_after_start': 'ready',
    'taps_during_ready': 0, 'taps_after_30_and_hold': 31, 'paused': 'paused', 'pause_freezes': True, 'resumed': 'running',
    'result_state': 'result', 'state_after_mash_on_result': 'result', 'image_modal': True, 'retry_state': 'ready',
    'clear_state': 'result', 'album_count': 'COLLECTION 01 / 10', 'after_corrupt_reload_cards': 1, 'race_npcs': 5,
    'break_state': 'break', 'break_after_mash': 'break', 'after_hold': 'ready', 'race_death_state': 'ready',
    'safezone_overlap_1920': [], 'safezone_overlap_phone': []
}
bad = {k: (log.get(k), v) for k, v in expect.items() if log.get(k) != v}
print(json.dumps({k: log[k] for k in ['z_after', 'prog_text', 'result_head', 'clear_head', 'race_rank_text', 'race_result_head'] if k in log}, ensure_ascii=False))
print('UI checks:', len(expect) - len(bad), '/', len(expect), 'passed', '' if not bad else bad)
print('ERRORS:', len(errors)); [print(' ', e) for e in errors[:30]]
