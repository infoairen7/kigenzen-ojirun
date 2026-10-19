"""Browser-to-browser online races (the default, no server URL): game pages connect over WebRTC, finding each other
through the local stand-in for the PeerJS broker (local-server.mjs /peerjs). Stub renderer, fast room timers.
usage: p2p_test.py HTML SERVER_DIR"""
import sys, tempfile, os, json, subprocess, random
from playwright.sync_api import sync_playwright
HTML, SRV = sys.argv[1], sys.argv[2]
STUB = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'three_stub.js')).read()
PORT = 21000 + random.randint(0, 900)
FAST = "{ lobbyAutoMs: 1500, fullAutoMs: 800, afterRaceAutoMs: 3000, goDelayMs: 1500, finishGraceMs: 15000, idleMs: 8000, sweepMs: 1000 }"
INIT = "window.TORCH_PEER = { host: '127.0.0.1', port: %d, secure: false }; window.TORCH_ICE = []; window.TORCH_ROOM_OPTS = %s;" % (PORT, FAST)
checks, errs, log = [], [], {}
def ck(name, ok, info=None):
    checks.append((name, bool(ok))); print(('OK   ' if ok else 'FAIL ') + name + ('' if ok or info is None else '  ' + json.dumps(info, ensure_ascii=False)[:300]), flush=True)

def start_broker():
    p = subprocess.Popen(['node', os.path.join(SRV, 'dev', 'local-server.mjs'), '--port', str(PORT), '--fast', '--host', '127.0.0.1'], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    while 'online server' not in p.stdout.readline(): pass
    return p
srv = start_broker()

with sync_playwright() as pw:
    b = pw.chromium.launch()
    def page(name, w=1280, h=720, loc='ja-JP', init=INIT):
        ctx = b.new_context(viewport={'width': w, 'height': h}, locale=loc); ctx.add_init_script(init); pg = ctx.new_page()
        pg.on('pageerror', lambda e: errs.append(name + ': ' + str(e)))
        pg.route('**/three.min.js', lambda r: r.fulfill(status=200, content_type='application/javascript', body=STUB))
        pg.route('https://fonts.**', lambda r: r.abort())
        pg.goto('file://' + HTML); pg.wait_for_function('window.__torch && __torch.G && __torch.G.save'); pg.wait_for_timeout(300)
        pg.evaluate("__torch.G.save.tutorialDone = true; __torch.G.save.itemTips = 9; __torch.G.save.settings.music = false; void 0")
        pg.name = name
        return pg
    def until(pg, js, n=200, step=50):
        for i in range(n):
            if pg.evaluate(js): return True
            pg.wait_for_timeout(step)
        return False

    A, B, C = page('A'), page('B'), page('C', 960, 540, 'en-US')
    # ---- lobby ----
    A.click('#btn-online'); until(A, "!document.querySelector('#scr-online').hidden")
    ck('no server URL: browser-to-browser mode', A.evaluate("__torch.netMode()") == 'p2p' and A.evaluate("__torch.p2pOK()"))
    ck('buttons are on and the screen says no server is needed', A.evaluate("!document.querySelector('#on-quick').disabled && !document.querySelector('#on-noserver').hidden") and 'サーバーの準備はいりません' in A.inner_text('#on-noserver'))
    A.fill('#on-name', 'あきら'); A.press('#on-name', 'Tab')
    A.click('#on-create'); until(A, "!!__torch.NET.code && !document.querySelector('#on-room').hidden")
    code = A.evaluate("__torch.NET.code"); log['code'] = code
    ck('room created with a 5-letter code', isinstance(code, str) and len(code) == 5 and A.inner_text('#on-roomcode') == code)
    ck('the host is told their browser runs the room', '中継役' in A.inner_text('#on-noserver') and A.evaluate("!document.querySelector('#on-noserver').hidden"))
    for pg, nm in ((B, 'ベン'), (C, 'Carl')):
        pg.click('#btn-online'); pg.fill('#on-name', nm); pg.press('#on-name', 'Tab')
        pg.fill('#on-code', code.lower()); pg.click('#on-joinbtn')
        until(pg, "!document.querySelector('#on-room').hidden", 300)
    until(A, "__torch.NET.players.length === 3")
    ck('three players in the room', A.evaluate("__torch.NET.players.length") == 3 and B.evaluate("__torch.NET.players.length") == 3 and C.evaluate("__torch.NET.players.length") == 3)
    ck('guests connect browser to browser', B.evaluate("!!(__torch.NET.ws && __torch.NET.ws.p2p && !__torch.NET.ws.isHost)") and A.evaluate("__torch.NET.ws.isHost"))
    ck('guests do not get the host note', B.evaluate("document.querySelector('#on-noserver').hidden"))
    ck('roster shows 3 players and 3 computer places', A.evaluate("document.querySelectorAll('#on-list li').length") == 6 and A.evaluate("document.querySelectorAll('#on-list li.cpu').length") == 3)
    ck('only the host sees start', not A.evaluate("document.querySelector('#on-start').hidden") and B.evaluate("document.querySelector('#on-start').hidden"))
    A.select_option('#on-era', '6'); A.click('#on-short')
    until(B, "__torch.NET.cfg.era === 6 && __torch.NET.cfg.short === true")
    ck('host settings reach the guests', B.evaluate("__torch.NET.cfg.era") == 6 and C.evaluate("__torch.NET.cfg.short") is True)
    ck('English lobby text', 'Room code' in C.inner_text('#on-room') and 'Computer' in C.inner_text('#on-list'))
    ck('the clock is in sync', B.evaluate("__torch.NET.rtt") < 200, B.evaluate("__torch.NET.rtt"))
    # ---- race ----
    A.click('#on-start')
    for pg in (A, B, C): until(pg, "__torch.G.state === 'running'", 200)
    ck('everyone runs the same course', all(pg.evaluate("__torch.G.state === 'running' && __torch.G.course.era === 6 && __torch.G.course.short") for pg in (A, B, C)))
    t_run = [pg.evaluate("performance.timeOrigin + performance.now() - (__torch.G.run.runTime * 1000)") for pg in (A, B, C)]
    ck('the start is in sync (< 0.25 s apart)', max(t_run) - min(t_run) < 250, t_run)
    rv = A.evaluate("__torch.G.npcs.map(n => [n.key, !!n.remote, !!n.human])")
    ck('host runs 3 computer rivals and sees 2 players', len(rv) == 5 and sum(1 for r in rv if r[2]) == 2)
    ck('guests replay the computer rivals', B.evaluate("__torch.G.npcs.length === 5 && __torch.G.npcs.every(n => !!n.remote)"))
    for pg in (A, B, C): pg.keyboard.down('Space')
    for pg in (A, B, C): until(pg, "__torch.G.run.runTime > 2.5", 200)
    idA = A.evaluate("__torch.NET.id")
    zA = A.evaluate("__torch.G.run.p.z"); seen = C.evaluate("(__torch.G.npcs.find(n => n.key === '%s') || {run:{p:{z:-99}}}).run.p.z" % idA); zA2 = A.evaluate("__torch.G.run.p.z")
    ck('the host is replayed on a guest screen', abs(seen - zA) < 4 or abs(seen - zA2) < 4, [zA, seen, zA2])
    idB = B.evaluate("__torch.NET.id")
    zB = B.evaluate("__torch.G.run.p.z"); seenB = C.evaluate("(__torch.G.npcs.find(n => n.key === '%s') || {run:{p:{z:-99}}}).run.p.z" % idB); zB2 = B.evaluate("__torch.G.run.p.z")
    ck('guest to guest goes through the host', abs(seenB - zB) < 5 or abs(seenB - zB2) < 5, [zB, seenB, zB2])
    bA = A.evaluate("__torch.G.npcs.find(n => n.key === 'b0').run.p.z"); bB = B.evaluate("__torch.G.npcs.find(n => n.key === 'b0').run.p.z")
    ck('computer rivals match between host and guests', abs(bA - bB) < 4, [bA, bB])
    # an item: the host throws a boomerang at B
    A.evaluate("(()=>{ for (const n of __torch.G.npcs) if (!n.human) { n.run.p.z += 150; n.run.p.prevZ = n.run.p.z; } })()")
    zb = B.evaluate("__torch.G.run.p.z")
    A.evaluate("""(zb => { const T = __torch.T, r = __torch.G.run, z = zb - 7, s = T.supportAt(r.course, z, 50); Object.assign(r.p, { z, prevZ: z, x: 0, prevX: 0, y: s ? s.y : r.p.y, prevY: s ? s.y : r.p.y }); })(%f)""" % zb)
    C.evaluate("(zb => { const r = __torch.G.run; r.p.z = zb - 40; r.p.prevZ = r.p.z; })(%f)" % zb)
    A.wait_for_timeout(500)
    B.evaluate("__torch.G.ch.immune = 0; __torch.G.run.buffs.wig = 0")
    A.evaluate("__torch.G.ch.mine = 'boomerang'; __torch.G.ch.rollT = 0"); A.keyboard.press('KeyE')
    until(B, "__torch.G.ch.hitBy >= 1", 80)
    ck('a boomerang hits another player', B.evaluate("__torch.G.ch.hitBy") >= 1)
    until(A, "__torch.G.ch.hits >= 1", 60)
    ck('the thrower hears it landed', A.evaluate("__torch.G.ch.hits") >= 1)
    B.evaluate("__torch.G.ch.mine = 'burr'; __torch.G.ch.rollT = 0"); B.keyboard.press('KeyE')
    until(C, "__torch.G.ch.burrs.length >= 1", 60)
    ck('a guest\'s chestnut appears on every screen', A.evaluate("__torch.G.ch.burrs.length") >= 1 and C.evaluate("__torch.G.ch.burrs.length") >= 1)
    # ---- finish ----
    def finish(pg):
        pg.evaluate("(()=>{const r=__torch.G.run; r.cp=r.course.checkpoints.length-1; r.p.z = r.course.L - 0.5; r.p.prevZ = r.p.z; r.p.vz = 8; r.flame = 50;})()")
    finish(B); until(B, "__torch.G.state === 'result'", 120)
    ck('a guest finishes first', '1位' in B.inner_text('#r-head'), B.inner_text('#r-head'))
    until(A, "__torch.G.npcs.filter(n => n.human && n.finished).length >= 1", 60)
    finish(A); until(A, "__torch.G.state === 'result'", 120)
    ck('the host sees 2nd place', '2位' in A.inner_text('#r-head'), A.inner_text('#r-head'))
    finish(C); until(C, "__torch.G.state === 'result'", 120)
    for pg in (A, B, C): until(pg, "!!__torch.NET.race && __torch.NET.race.over", 100)
    ck('results arrive for everyone', all(pg.evaluate("!!__torch.NET.race && __torch.NET.race.over") for pg in (A, B, C)))
    standC = C.evaluate("__torch.standings().filter(r => r.me || (r.npc && r.npc.human)).map(r => r.me ? 'me' : r.name)")
    ck('final order agrees', standC[:3] == ['ベン', 'あきら', 'me'], standC)
    for pg in (A, B, C): pg.keyboard.up('Space')
    # ---- second race; the host closes the page mid-race ----
    for pg in (A, B, C): pg.wait_for_timeout(300); pg.click('#r-lobby'); until(pg, "!document.querySelector('#scr-online').hidden", 60)
    ck('back in the room after the race', all(pg.evaluate("!document.querySelector('#scr-online').hidden && __torch.NET.players.length === 3") for pg in (A, B, C)))
    A.click('#on-start')
    for pg in (A, B, C): until(pg, "__torch.G.state === 'running'", 200); pg.keyboard.down('Space')
    A.wait_for_timeout(1200)
    A.close(run_before_unload=True)   # closing the tab: pagehide closes the room
    until(B, "!__torch.NET.ws", 120)
    ck('closing the host tab ends the room within 6 s', B.evaluate("!__torch.NET.ws"))
    until(B, "!__torch.NET.ws", 240)
    ck('guests notice the host is gone', B.evaluate("!__torch.NET.ws") and C.evaluate("!__torch.NET.ws"))
    ck('the race carries on against the computer', B.evaluate("__torch.G.state") in ('running', 'ready', 'dying') and B.evaluate("__torch.G.npcs.length === 3 && __torch.G.npcs.every(n => !n.human && !n.remote)"), B.evaluate("__torch.G.npcs.map(n => [n.key, !!n.human, !!n.remote])"))
    z0 = B.evaluate("__torch.G.npcs[0].run.p.z"); B.wait_for_timeout(1200); z1 = B.evaluate("__torch.G.npcs[0].run.p.z")
    ck('...with the rivals still moving', z1 > z0 + 2, [z0, z1])
    for pg in (B, C): pg.keyboard.up('Space')
    B.evaluate("__torch.goTitle(); __torch.openOnline()"); B.wait_for_timeout(200)
    ck('the online screen explains what happened', '部屋を作った人との接続が切れました' in B.inner_text('#on-status'), B.inner_text('#on-status'))
    # ---- a code nobody has ----
    B.fill('#on-code', 'ZZZZZ'); B.click('#on-joinbtn')
    until(B, "!__torch.NET.busy && !!document.querySelector('#on-status').textContent", 200)
    ck('unknown code: says so', '見つかりませんでした' in B.inner_text('#on-status'), B.inner_text('#on-status'))
    # ---- quick match ----
    D, E = page('D'), page('E')
    D.click('#btn-online'); D.click('#on-quick'); until(D, "!!__torch.NET.code", 200)
    E.click('#btn-online'); E.click('#on-quick'); until(E, "!!__torch.NET.code", 300)
    ck('quick match puts both in the same room', D.evaluate("__torch.NET.code") == E.evaluate("__torch.NET.code") == 'QUICK1' and D.evaluate("__torch.NET.ws.isHost") and not E.evaluate("__torch.NET.ws.isHost"))
    ck('quick room shows a countdown', 'スタート' in D.inner_text('#on-wait'), D.inner_text('#on-wait'))
    for pg in (D, E): until(pg, "__torch.G.state === 'ready' || __torch.G.state === 'running'", 160)
    ck('quick room starts by itself', all(pg.evaluate("__torch.G.state") in ('ready', 'running') for pg in (D, E)))
    F = page('F'); F.click('#btn-online'); F.click('#on-quick'); until(F, "!!__torch.NET.code", 300)
    ck('a racing quick room is skipped', F.evaluate("__torch.NET.code") == 'QUICK2' and F.evaluate("__torch.NET.ws.isHost"), F.evaluate("__torch.NET.code"))
    # a guest leaves the lobby by closing the page
    G1 = page('G1'); G1.click('#btn-online'); G1.click('#on-quick'); until(G1, "__torch.NET.code === 'QUICK2'", 300)
    until(F, "__torch.NET.players.length === 2", 100)
    ck('a second player joins the waiting quick room', F.evaluate("__torch.NET.players.length") == 2)
    G1.close(run_before_unload=True); until(F, "__torch.NET.players.length === 1", 120)
    ck('a guest closing the tab leaves the room', F.evaluate("__torch.NET.players.length") == 1)
    G2 = page('G2'); G2.click('#btn-online'); G2.click('#on-quick'); until(G2, "__torch.NET.code === 'QUICK2'", 300)
    until(F, "__torch.NET.players.length === 2", 100)
    G2.context.close(); until(F, "__torch.NET.players.length === 1", 300)   # gone without a word: the room's idle check (8 s here)
    ck('a guest that vanishes is dropped', F.evaluate("__torch.NET.players.length") == 1)
    # the host vanishes without a word: guests notice within ~10 s
    H1 = page('H1'); H1.click('#btn-online'); H1.click('#on-create'); until(H1, "!!__torch.NET.code", 200)
    H2 = page('H2'); H2.click('#btn-online'); H2.fill('#on-code', H1.evaluate("__torch.NET.code")); H2.click('#on-joinbtn'); until(H2, "!!__torch.NET.code", 300)
    H1.context.close(); until(H2, "!__torch.NET.ws", 300)
    ck('a host that vanishes is noticed', H2.evaluate("!__torch.NET.ws") and '部屋を作った人' in H2.inner_text('#on-status'), H2.inner_text('#on-status'))
    # ---- the broker cannot be reached ----
    X = page('X', init="window.TORCH_PEER = { host: '127.0.0.1', port: 9, secure: false }; window.TORCH_ICE = [];")
    X.click('#btn-online'); X.click('#on-create'); until(X, "!__torch.NET.busy && !!document.querySelector('#on-status').textContent", 300)
    ck('no broker: says so', 'PeerJS' in X.inner_text('#on-status'), X.inner_text('#on-status'))
    # ---- a server URL still uses the server ----
    ck('a server URL switches to server mode', X.evaluate("__torch.G.save.settings.server = 'ws://127.0.0.1:%d'; __torch.netMode()" % PORT) == 'server')
    X.evaluate("__torch.G.save.settings.server = ''")
    for pg in (B, C, D, E, F): pg.screenshot(path=os.path.join(tempfile.gettempdir(), 'p2p_%s.png' % pg.name))
    b.close()
srv.kill()
print(json.dumps(log, ensure_ascii=False)[:300])
print('p2p checks: %d / %d' % (sum(ok for _, ok in checks), len(checks)), 'errors', errs[:6])
