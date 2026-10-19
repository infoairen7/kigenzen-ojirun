"""v15: BGM on/off — title button, B key, pause menu, settings row, controller BACK; saved; SFX and voices keep playing;
the music bus goes silent and stops scheduling; the sound test turns music back on; English labels."""
import sys, os, json
from playwright.sync_api import sync_playwright
LOCALE = os.environ.get('TORCH_LOCALE', 'ja-JP')
HTML = sys.argv[1]
STUB = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'three_stub.js')).read()
out, checks, errs = {}, [], []
def ok(name, cond, val=None): checks.append((name, bool(cond))); out[name] = val if val is not None else bool(cond)
def until(page, js, n=100):
    for i in range(n):
        if page.evaluate(js): return True
        page.wait_for_timeout(100)
    return False
FAKEPAD = """(() => { const mk = () => Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }));
  window.__pad = { connected: true, id: 'fake', index: 0, buttons: mk(), axes: [0, 0, 0, 0], mapping: 'standard' };
  navigator.getGamepads = () => [window.__pad]; })()"""
MUSIC = "({ set: __torch.G.save.settings.music, off: !!(__torch.Snd.E && __torch.Snd.E.musicOff), gain: __torch.Snd.E ? +__torch.Snd.E.nodes.musicVol.gain.value.toFixed(3) : null })"
with sync_playwright() as pw:
    b = pw.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
    ctx = b.new_context(viewport={'width': 1280, 'height': 720}, locale=LOCALE); page = ctx.new_page()
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.route('**/three.min.js', lambda r: r.fulfill(status=200, content_type='application/javascript', body=STUB))
    page.route('https://fonts.**', lambda r: r.abort())
    page.goto('file://' + HTML); page.wait_for_function('window.__torch && __torch.G && __torch.G.save'); page.wait_for_timeout(500)
    ev = page.evaluate; ev("__torch.G.save.tutorialDone = true; __torch.G.save.settings.chotto = false")
    en = LOCALE.startswith('en')
    ON, OFF = ('MUSIC ON', 'MUSIC OFF') if en else ('BGM ON', 'BGM OFF')
    ok('title_focus_start', ev("document.activeElement && document.activeElement.id") == 'btn-start', ev("document.activeElement && document.activeElement.id"))
    ok('default_on', ev("__torch.G.save.settings.music") is True and ev("document.getElementById('music-btn-t').textContent") == ON, ev("document.getElementById('music-btn-t').textContent"))
    box = ev("(() => { const a = document.getElementById('music-btn').getBoundingClientRect(), l = document.querySelector('.lang-pick').getBoundingClientRect(); return { a: [a.left, a.top, a.right, a.bottom].map(Math.round), l: [l.left, l.top, l.right, l.bottom].map(Math.round) }; })()")
    ok('button_beside_lang', box['a'][2] <= box['l'][0] and abs(box['a'][1] - box['l'][1]) <= 2 and abs(box['a'][3] - box['l'][3]) <= 2 and box['a'][2] - box['a'][0] < 140, box)
    page.click('#music-btn'); page.wait_for_timeout(400)
    r = ev(MUSIC); ok('title_button_off', r['set'] is False and r['off'] and r['gain'] < 0.05 and ev("document.getElementById('music-btn-t').textContent") == OFF and ev("document.getElementById('music-btn').getAttribute('aria-pressed')") == 'false', r)
    # saved across a reload
    page.reload(); page.wait_for_function('window.__torch && __torch.G && __torch.G.save'); page.wait_for_timeout(400)
    ok('saved_off', ev("__torch.G.save.settings.music") is False and ev("document.getElementById('music-btn-t').textContent") == OFF)
    page.mouse.click(5, 700); page.wait_for_timeout(300)   # a gesture: the audio engine starts with the music already off
    r = ev(MUSIC); ok('engine_starts_off', r['off'] and r['gain'] < 0.05, r)
    page.keyboard.press('KeyB'); page.wait_for_timeout(400)
    r = ev(MUSIC); toast = ev("(document.querySelector('.toast-menu') || {}).textContent || ''")
    ok('b_key_on', r['set'] is True and not r['off'] and r['gain'] > 0.3 and ('BGM' in toast or 'Music' in toast), dict(r, toast=toast))
    # in a run: B turns the music off, sound effects still play
    ev("__torch.G.save.tutorialDone = true; __torch.G.save.settings.chotto = false")
    page.click('#len-short'); page.click('#mode-solo'); page.click('#btn-start'); until(page, "__torch.G.state === 'running'")
    page.keyboard.press('KeyB'); page.wait_for_timeout(300)
    tp = ev("(() => { const t = document.querySelector('.toast-menu'), p = document.querySelector('.hud-tc'); if (!t) return null; return [Math.round(t.getBoundingClientRect().top), Math.round(p.getBoundingClientRect().bottom)]; })()")
    s0 = ev("JSON.stringify(__torch.Snd.E.stats.sfx)"); page.keyboard.down('Space'); page.wait_for_timeout(1500); page.keyboard.press('ShiftLeft'); page.wait_for_timeout(700); s1 = ev("JSON.stringify(__torch.Snd.E.stats.sfx)")
    r = ev(MUSIC)
    ok('run_b_off_sfx_on', r['set'] is False and r['gain'] < 0.05 and s1 != s0, dict(r, sfx_changed=s1 != s0))
    ok('run_toast_below_panel', tp is not None and tp[0] >= tp[1], tp)
    # nothing is scheduled on the music bus while it is off
    ev("window.__steps = 0; const E = __torch.Snd.E, c = E.CUES; for (const k in c) { const f = c[k].step; c[k].step = function () { window.__steps++; return f.apply(this, arguments); }; } 0;")
    page.wait_for_timeout(800); n_off = ev("window.__steps")
    page.keyboard.up('Space')
    # pause menu button
    page.keyboard.press('Escape'); page.wait_for_timeout(300)
    lab = ev("document.getElementById('p-music').textContent")
    ok('pause_label_off', lab in ('BGM：オフ', 'Music: off'), lab)
    page.click('#p-music'); page.wait_for_timeout(500); n_on = ev("window.__steps")
    r = ev(MUSIC); ok('pause_button_on', r['set'] is True and not r['off'] and ev("document.getElementById('p-music').textContent") in ('BGM：オン', 'Music: on'), r)
    ok('scheduler_idle_when_off', n_off == 0 and n_on > 0, [n_off, n_on])
    # settings row
    page.click('#p-settings'); page.wait_for_timeout(300)
    row = ev("document.getElementById('s-music').closest('.set-row').innerText")
    page.click('#s-music'); page.wait_for_timeout(300)
    ok('settings_toggle', ev("__torch.G.save.settings.music") is False and ev("document.getElementById('s-music').textContent") == 'OFF' and (('音楽を鳴らす' in row) if not en else ('Play the music' in row and 'Music' in row)), row.replace('\n', ' | '))
    page.click('#s-done'); page.wait_for_timeout(300)
    # controller BACK
    ev(FAKEPAD); page.wait_for_timeout(300)
    ev("__torch.G.save.settings.music = false"); ev("window.__pad.buttons[8] = { pressed: true, value: 1 }"); page.wait_for_timeout(250); ev("window.__pad.buttons[8] = { pressed: false, value: 0 }"); page.wait_for_timeout(250)
    ok('pad_back_toggles', ev("__torch.G.save.settings.music") is True)
    # the sound test turns the music back on when a track is picked
    ev("__torch.goTitle()"); page.wait_for_timeout(300)
    page.keyboard.press('KeyB'); page.wait_for_timeout(200)
    page.click('#btn-settings'); page.wait_for_timeout(200); page.click('#s-soundtest'); page.wait_for_timeout(300)
    page.click('#st-bgm .chip-btn'); page.wait_for_timeout(300)
    ok('soundtest_turns_on', ev("__torch.G.save.settings.music") is True and not ev("__torch.Snd.E.musicOff"))
    # the keyboard hint on the title shows the B key
    ev("__torch.goTitle()"); page.wait_for_timeout(300)
    keys = ev("document.getElementById('title-keys').textContent")
    ok('title_keys_b', ('B BGM' in keys) if not en else ('B music' in keys), keys)
    ev("__torch.G.save.settings.music = true")
    b.close()
print(json.dumps(out, ensure_ascii=False, indent=1))
print('bgm checks:', sum(1 for _, c in checks if c), '/', len(checks), [n for n, c in checks if not c])
print('errors', errs[:5])
