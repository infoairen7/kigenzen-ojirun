"""Era flow checks with the stub renderer: pick an era, its words on falls and clears, next-era button, unlocks, records, EN text."""
import sys, os, json
from playwright.sync_api import sync_playwright
HTML = sys.argv[1]
STUB = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'three_stub.js')).read()
log, errs, checks = {}, [], []
def ck(name, ok): checks.append((name, bool(ok)))
with sync_playwright() as pw:
    b = pw.chromium.launch()
    ctx = b.new_context(viewport={'width': 1280, 'height': 720}, locale='ja-JP'); page = ctx.new_page()
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.route('**/three.min.js', lambda r: r.fulfill(status=200, content_type='application/javascript', body=STUB))
    page.route('https://fonts.**', lambda r: r.abort())
    page.goto('file://' + HTML); page.wait_for_function('window.__torch && __torch.G && __torch.G.save'); page.wait_for_timeout(500)
    ev = page.evaluate
    ev("__torch.G.save.tutorialDone = true; __torch.G.save.itemTips = 9; void 0")
    def until(js, n=200):
        for i in range(n):
            if ev(js): return True
            page.wait_for_timeout(50)
        return False
    def force_clear():
        ev("(()=>{const r=__torch.G.run; r.cp=r.course.checkpoints.length-1; r.p.z = r.course.L - 0.5; r.p.prevZ = r.p.z; r.p.vz = 8; r.flame = 50;})()")
        until("__torch.G.state === 'result'", 200); page.wait_for_timeout(1300)
    page.click('#mode-solo'); page.click('#len-std')
    page.click('#btn-era'); page.wait_for_timeout(150)
    log['cards'] = ev("[...document.querySelectorAll('#era-grid .era-card')].map(b => !b.disabled).filter(Boolean).length")
    ck('nine playable eras', log['cards'] == 9)
    page.locator('#era-grid .era-card').nth(3).click()
    until("__torch.G.state === 'running'")
    log['era_run'] = ev("__torch.G.course.era"); ck('era card starts that era', log['era_run'] == 3)
    page.wait_for_timeout(300)
    log['prog_era'] = page.inner_text('#prog-era'); ck('hud era label', '04 中世' in log['prog_era'])
    log['year0'] = page.inner_text('#year') if ev("!!document.querySelector('#year')") else ''
    # gate note after the first checkpoint
    ev("(()=>{const r=__torch.G.run, c=r.course, z=c.checkpoints[1]-0.3; r.p.z = z; r.p.prevZ = z - 0.3; r.p.vz = 8; r.p.x = 0; r.p.prevX = 0; const s=__torch.T.supportAt(c, z, 50); r.p.y = r.p.prevY = s ? s.y : 0; r.lastSafe = {x:0, y:r.p.y, z}; })()")
    until("__torch.G.run.cp >= 1", 100); page.wait_for_timeout(200)
    log['gate_note'] = ev("document.querySelector('#gate-note').textContent + ' | ' + document.querySelector('#b-note').textContent")
    ck('gate note from this era', 'カール大帝' in log['gate_note'] or '長安' in log['gate_note'])
    if until("__torch.G.state === 'break'", 200):
        until("performance.now() > (__torch.G.breakLockUntil || 0) + 50", 200); page.click('#b-go'); until("__torch.G.state === 'running'", 300); page.wait_for_timeout(200)
    log['after_break'] = ev("__torch.G.state")
    # fall
    ev("(()=>{const r=__torch.G.run; r.p.y = r.p.prevY = -20; r.p.vy = -5; r.p.grounded = false;})()")
    until("__torch.G.state === 'result' || __torch.G.run.result === 'fall'", 200)
    log['after_fall'] = ev("({ st: __torch.G.state, res: __torch.G.run.result, y: __torch.G.run.p.y, x: __torch.G.run.p.x })")
    until("__torch.G.state === 'result'", 300); page.wait_for_timeout(1000)
    log['fall_head'] = page.inner_text('#r-head'); log['eyebrow'] = page.inner_text('#r-eyebrow')
    ck('eyebrow era no', 'ERA RUN 04' in log['eyebrow'])
    page.click('#r-retry'); until("__torch.G.state === 'running'"); page.wait_for_timeout(300)
    force_clear()
    log['clear_head'] = page.inner_text('#r-head'); log['clear_sub'] = page.inner_text('#r-sub')
    ck('clear head names the era', '中世を走りきった' in log['clear_head'] and '1500' in log['clear_head'])
    ck('card 04 got', ev("__torch.G.save.cards.some(c => c.id === 'card_04')"))
    ck('era 05 unlocked', ev("__torch.G.save.unlockedEras.includes('era_05')"))
    ck('record under era_04', ev("!!__torch.G.save.best.era_04"))
    log['next_visible'] = ev("!document.querySelector('#r-next').hidden"); log['next_sub'] = page.inner_text('#r-next-sub')
    ck('next era button', log['next_visible'] and '05 近世' in log['next_sub'])
    page.click('#r-next'); until("__torch.G.state === 'running'"); page.wait_for_timeout(300)
    ck('next era starts', ev("__torch.G.course.era") == 4 and '05 近世' in page.inner_text('#prog-era'))
    # last era
    ev("__torch.G.save.settings.era = 8; __torch.startRun()"); until("__torch.G.state === 'running'"); page.wait_for_timeout(300)
    force_clear()
    log['last_head'] = page.inner_text('#r-head')
    ck('last era arrival', '現代に到着' in log['last_head'] and ev("document.querySelector('#r-next').hidden"))
    # era grid shows clears
    page.click('#r-era'); page.wait_for_timeout(200)
    log['grid_states'] = ev("[...document.querySelectorAll('#era-grid .era-state')].map(e => e.textContent)")
    ck('grid marks clears', log['grid_states'][3].startswith('CLEAR') and log['grid_states'][8].startswith('CLEAR'))
    # English
    page.keyboard.press('Escape'); page.wait_for_timeout(200)
    ev("__torch.G.save.settings.lang = 'en'"); page.click('#lang-en') if ev("!!document.querySelector('#lang-en') && document.querySelector('#lang-en').offsetParent !== null") else ev("setLang && setLang('en')")
    page.wait_for_timeout(200)
    ev("__torch.G.save.settings.era = 6; __torch.startRun()"); until("__torch.G.state === 'running'"); page.wait_for_timeout(300)
    log['en_prog'] = page.inner_text('#prog-era'); ck('EN hud label', '07 Showa Style' in log['en_prog'])
    ev("(()=>{const r=__torch.G.run; r.p.y = r.p.prevY = -20; r.p.vy = -5; r.p.grounded = false;})()")
    until("__torch.G.run.result === 'fall' || __torch.G.state === 'result'", 200); ev("__torch.G.run.flame = 0.01"); until("__torch.G.state === 'result'", 300); page.wait_for_timeout(900)
    log['en_head'] = page.inner_text('#r-head')
    b.close()
print(json.dumps(log, ensure_ascii=False, indent=1))
for n, ok in checks: print(('OK  ' if ok else 'FAIL') + ' ' + n)
print('era ui: %d / %d' % (sum(ok for _, ok in checks), len(checks)), 'errors', errs[:5])
