/* Room protocol test against the local server (node test/room-test.mjs). Needs Node 22+ (global WebSocket). */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = 18787 + Math.floor(Math.random() * 1000);
const srv = spawn(process.execPath, [path.join(here, '..', 'dev', 'local-server.mjs'), '--port', String(PORT), '--fast', '--host', '127.0.0.1'], { stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((res) => srv.stdout.on('data', (d) => { if (String(d).includes('online server')) res(); }));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (name, c) => { if (c) pass++; else fail++; console.log((c ? 'OK   ' : 'FAIL ') + name); };

function client(room, name, extra) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws?room=${room}&name=${encodeURIComponent(name)}&ver=1${extra || ''}`);
  const c = { ws, msgs: [], name, closed: false };
  ws.onmessage = (e) => c.msgs.push(JSON.parse(e.data));
  ws.onclose = (e) => { c.closed = true; c.closeCode = e.code; };
  c.send = (m) => ws.send(JSON.stringify(m));
  c.wait = async (pred, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const m = c.msgs.find(pred); if (m) return m; await sleep(20); } return null; };
  c.last = (t) => { for (let i = c.msgs.length - 1; i >= 0; i--) if (c.msgs[i].t === t) return c.msgs[i]; return null; };
  return c;
}

// private room: create, join, config, start, relay, finish, results
const A = client('ABCDE', 'あきら', '&create=1&era=3&short=1');
const wa = await A.wait(m => m.t === 'welcome'); ok('welcome to the creator', wa && wa.id && wa.code === 'ABCDE' && !wa.pub);
const B = client('ABCDE', 'ベン<script>', '&join=1');
const wb = await B.wait(m => m.t === 'welcome'); ok('second player joins', !!wb);
await sleep(100);
const room = A.last('room'); ok('room lists both, creator hosts, era from creator', room && room.players.length === 2 && room.host === wa.id && room.cfg.era === 3 && room.cfg.short === true);
ok('names are cleaned', room.players[1].name === 'ベンscript');
const X = client('ABCDE', 'x', '&create=1'); await X.wait(m => m.t === 'err'); ok('create on a taken code is refused', X.msgs[0] && X.msgs[0].code === 'taken');
const Y = client('ZZZZZ', 'y', '&join=1'); await Y.wait(m => m.t === 'err'); ok('joining an empty code is refused', Y.msgs[0] && Y.msgs[0].code === 'noroom');
const V = client('ABCDE', 'v', '').ws; // wrong version below
const W = new WebSocket(`ws://127.0.0.1:${PORT}/ws?room=ABCDE&name=w&ver=0`); const wm = []; W.onmessage = (e) => wm.push(JSON.parse(e.data)); await sleep(300);
ok('old game version is refused', wm[0] && wm[0].code === 'ver');
V.close(); await sleep(200);
B.send({ t: 'cfg', era: 7, short: false }); await sleep(150); ok('only the host can change settings', A.last('room').cfg.era === 3);
A.send({ t: 'cfg', era: 7, short: false }); await sleep(150); ok('host changes era', B.last('room').cfg.era === 7 && B.last('room').cfg.short === false);
A.send({ t: 'ping', c: 123 }); const pong = await A.wait(m => m.t === 'pong'); ok('ping answers with server time', pong && pong.c === 123 && pong.s > 0);
B.send({ t: 'start' }); await sleep(150); ok('only the host can start', !B.last('go'));
A.send({ t: 'start' });
const goA = await A.wait(m => m.t === 'go'), goB = await B.wait(m => m.t === 'go');
ok('go reaches everyone with the same start time', goA && goB && goA.at === goB.at && goA.at > goA.now);
ok('go carries roster, bots and settings', goA.order.length === 2 && goA.bots === 4 && goA.cfg.era === 7 && goA.host === wa.id);
const C = client('ABCDE', 'c', ''); await C.wait(m => m.t === 'err'); ok('no joining a race in progress', C.msgs[0] && C.msgs[0].code === 'started');
A.send({ t: 'st', s: [12.345, 0.5, 0, 9.1, 0, 0, 1, 80, 90, 0, null] });
const stB = await B.wait(m => m.t === 'st'); ok('positions are relayed to the others', stB && stB.id === wa.id && stB.s[0] === 12.35);
await sleep(100); ok('...not echoed back', !A.last('st'));
B.send({ t: 'npc', b: [[0, 1, 2]] }); await sleep(100); ok('only the host sends rivals', !A.last('npc'));
A.send({ t: 'npc', b: [[0, 5, 0.2, 0, 8, 0, 0, 1, 70, 90, 0]] }); const npc = await B.wait(m => m.t === 'npc'); ok('host rivals relayed', npc && npc.b[0][1] === 5);
B.send({ t: 'it', k: 'boomerang', u: wb.id, to: 'b2', d: 0.8 }); const it = await A.wait(m => m.t === 'it'); ok('items relayed with sender', it && it.from === wb.id && it.to === 'b2' && it.k === 'boomerang');
B.send({ t: 'it', k: 'nuke' }); await sleep(100); ok('unknown items dropped', A.msgs.filter(m => m.t === 'it').length === 1);
A.send({ t: 'fin', time: 61.5, deaths: 2 }); const finB = await B.wait(m => m.t === 'fin'); ok('finish broadcast', finB && finB.id === wa.id && finB.time === 61.5);
B.send({ t: 'fin', time: 64.25, deaths: 0 });
const res = await A.wait(m => m.t === 'results'); ok('results once everyone is in', res && res.list[0].id === wa.id && res.list[1].time === 64.25 && res.why === 'done');
await sleep(100); ok('room is back to the lobby', A.last('room').phase === 'lobby');
// host leaves: the next player hosts
B.msgs.length = 0; A.ws.close(); const left = await B.wait(m => m.t === 'left'); ok('host leaving hands over to the next player', left && left.host === wb.id);
B.ws.close();

// quick match: auto start a moment after the second player
const Q1 = client('QUICK1', 'q1'); const wq = await Q1.wait(m => m.t === 'welcome'); ok('quick room is public', wq && wq.pub);
await sleep(300); ok('alone: no auto start', !Q1.last('room').autoAt);
const Q2 = client('QUICK1', 'q2'); await Q2.wait(m => m.t === 'welcome'); await sleep(100);
ok('two players: auto start scheduled', Q1.last('room').autoAt > 0);
const qgo = await Q1.wait(m => m.t === 'go', 4000); ok('quick room starts by itself', !!qgo);
// a player who leaves mid-race does not block the end
Q2.ws.close(); await sleep(200);
Q1.send({ t: 'fin', time: 10 }); const qres = await Q1.wait(m => m.t === 'results'); ok('race ends when the remaining players are in', !!qres);
// idle players are dropped
const I = client('IDLE1', 'idle'); await I.wait(m => m.t === 'welcome'); await sleep(10500);
ok('idle player dropped', I.closed && I.closeCode === 4001);
Q1.ws.close();
// full room
const F = []; for (let i = 0; i < 6; i++) { F.push(client('FULL1', 'f' + i)); await F[i].wait(m => m.t === 'welcome'); }
const F7 = client('FULL1', 'f7'); await F7.wait(m => m.t === 'err'); ok('seventh player refused', F7.msgs[0] && F7.msgs[0].code === 'full');
F.forEach(c => c.ws.close());
await sleep(200);
srv.kill();
console.log(`room test: ${pass} / ${pass + fail}`);
process.exit(fail ? 1 : 0);
