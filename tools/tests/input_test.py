"""Input: F/J alternate taps, gamepad (mocked) run/jump/pause/menu, second touch pad present."""
import sys, os, json
from playwright.sync_api import sync_playwright
LOCALE = __import__('os').environ.get('TORCH_LOCALE', 'ja-JP')
HTML = sys.argv[1]
STUB = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'three_stub.js')).read()
MOCK = """(() => { const st = { buttons: Array.from({length: 17}, () => ({ pressed: false, value: 0 })), axes: [0, 0, 0, 0] };
  window.__pad = { set(i, v) { st.buttons[i].pressed = v; st.buttons[i].value = v ? 1 : 0; }, axis(i, v) { st.axes[i] = v; } };
  navigator.getGamepads = () => [{ connected: true, id: 'mock', mapping: 'standard', buttons: st.buttons, axes: st.axes }]; })();"""
log = {}; errs = []
with sync_playwright() as pw:
    b = pw.chromium.launch()
    page = b.new_context(viewport={'width': 1280, 'height': 720}, locale=LOCALE).new_page()
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.route('**/three.min.js', lambda r: r.fulfill(status=200, content_type='application/javascript', body=STUB))
    page.route('https://fonts.googleapis.com/**', lambda r: r.abort()); page.route('https://fonts.gstatic.com/**', lambda r: r.abort())
    page.add_init_script(MOCK)
    page.goto('file://' + HTML); page.wait_for_timeout(700)
    page.wait_for_function('window.__torch && __torch.G && __torch.G.save'); page.evaluate("__torch.G.save.settings.runMode = 'mash'")   # MASH_MODE: these checks press keys one tap at a time
    # menu: D-pad down moves focus, A selects
    page.evaluate("__pad.set(13, true)"); page.wait_for_timeout(80); page.evaluate("__pad.set(13, false)"); page.wait_for_timeout(80)
    log['focus_after_down'] = page.evaluate("document.activeElement && document.activeElement.id")
    page.evaluate("__pad.set(12, true)"); page.wait_for_timeout(80); page.evaluate("__pad.set(12, false)"); page.wait_for_timeout(80)
    log['focus_after_up'] = page.evaluate("document.activeElement && document.activeElement.id")
    page.click('#len-short'); page.click('#mode-solo')
    page.evaluate("document.getElementById('btn-start').focus()")
    page.evaluate("__pad.set(0, true)"); page.wait_for_timeout(80); page.evaluate("__pad.set(0, false)"); page.wait_for_timeout(1300)
    log['state_after_A'] = page.evaluate('__torch.G.state')
    # alternate LB/RB 20 times
    for i in range(20):
        k = 4 if i % 2 else 5
        page.evaluate(f"__pad.set({k}, true)"); page.wait_for_timeout(60); page.evaluate(f"__pad.set({k}, false)"); page.wait_for_timeout(60)
    log['pad_taps'] = page.evaluate('__torch.G.run.stats.taps')
    log['pad_z'] = round(page.evaluate('__torch.G.run.p.z'), 1)
    page.evaluate("__pad.axis(0, -0.9)"); page.wait_for_timeout(300); log['pad_left_x'] = round(page.evaluate('__torch.G.run.p.x'), 2); page.evaluate("__pad.axis(0, 0)")
    page.evaluate("__pad.set(1, true)"); page.wait_for_timeout(100); log['pad_jump_air'] = not page.evaluate('__torch.G.run.p.grounded'); page.evaluate("__pad.set(1, false)"); page.wait_for_timeout(700)
    page.evaluate("__pad.set(9, true)"); page.wait_for_timeout(80); page.evaluate("__pad.set(9, false)"); page.wait_for_timeout(200)
    log['start_pauses'] = page.evaluate('__torch.G.state')
    page.evaluate("__pad.set(9, true)"); page.wait_for_timeout(80); page.evaluate("__pad.set(9, false)"); page.wait_for_timeout(1300)
    log['start_resumes'] = page.evaluate('__torch.G.state')
    t0 = page.evaluate('__torch.G.run.stats.taps')
    for i in range(20):
        k = 'KeyF' if i % 2 else 'KeyJ'; page.keyboard.press(k); page.wait_for_timeout(60)
    log['fj_taps'] = page.evaluate('__torch.G.run.stats.taps') - t0
    log['touch_run2'] = page.evaluate("!!document.getElementById('t-run2')")
    b.close()
expect = {'state_after_A': 'running', 'pad_taps': 20, 'pad_jump_air': True, 'start_pauses': 'paused', 'start_resumes': 'running', 'fj_taps': 20, 'touch_run2': True}
bad = {k: (log.get(k), v) for k, v in expect.items() if log.get(k) != v}
print(json.dumps(log, ensure_ascii=False))
print('input checks:', len(expect) - len(bad), '/', len(expect), bad or '', 'errors', errs[:5])
