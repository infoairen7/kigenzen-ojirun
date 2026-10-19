/* Checks the Cloudflare Worker + Durable Object wiring (src/index.js) with a small stand-in for the Workers
   runtime: WebSocketPair, a Response that allows status 101, and a ROOMS namespace. (node test/worker-test.mjs) */
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(`
  export async function resolve(spec, ctx, next) {
    if (spec === 'cloudflare:workers') return { url: 'data:text/javascript,' + encodeURIComponent('export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }'), shortCircuit: true };
    return next(spec, ctx);
  }`));

let pass = 0, fail = 0;
const ok = (name, c) => { if (c) pass++; else fail++; console.log((c ? 'OK   ' : 'FAIL ') + name); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

class MockSocket {
  constructor() { this.l = {}; this.peer = null; this.accepted = false; this.closed = false; }
  accept() { this.accepted = true; }
  addEventListener(t, fn) { (this.l[t] || (this.l[t] = [])).push(fn); }
  emit(t, ev) { for (const fn of this.l[t] || []) fn(ev); }
  send(s) { if (this.closed) throw new Error('closed'); const p = this.peer; setTimeout(() => p.emit('message', { data: s }), 0); }
  close(code, reason) { if (this.closed) return; this.closed = true; const p = this.peer; p.closed = true; setTimeout(() => { p.emit('close', { code, reason }); this.emit('close', { code, reason }); }, 0); }
}
globalThis.WebSocketPair = function () { const a = new MockSocket(), b = new MockSocket(); a.peer = b; b.peer = a; this[0] = a; this[1] = b; };
const RealResponse = Response;
globalThis.Response = class { constructor(body, init) { init = init || {}; this.status = init.status || 200; this.webSocket = init.webSocket; this.body = body; this.headers = new Map(Object.entries(init.headers || {})); } async json() { return JSON.parse(this.body); } };

const mod = await import('../src/index.js');
const worker = mod.default, Room = mod.Room;
const objects = new Map();
const env = { ALLOWED_ORIGINS: '', ROOMS: { idFromName: (n) => 'id:' + n, get: (id) => ({ fetch: (req) => { let o = objects.get(id); if (!o) { o = new Room({ id }, env); objects.set(id, o); } return o.fetch(req); } }) } };
const req = (path, headers) => new Request('https://srv.example' + path, { headers: headers || {} });

let r = await worker.fetch(req('/health'), env); ok('health check', r.status === 200 && (await r.json()).ok === true);
r = await worker.fetch(req('/ws?room=ABCDE'), env); ok('plain GET on /ws asks for a websocket', r.status === 426);
r = await worker.fetch(req('/ws?room=a!', { Upgrade: 'websocket' }), env); ok('bad room code refused', r.status === 400);
r = await worker.fetch(req('/nope'), env); ok('unknown path 404', r.status === 404);
ok('origin rules', mod.originAllowed('https://html-classic.itch.zone', '*.itch.zone') && !mod.originAllowed('https://evil.example', '*.itch.zone') && mod.originAllowed(null, '') && !mod.originAllowed(null, 'https://a.b') && mod.originAllowed('https://a.b', 'https://a.b, https://c.d'));
env.ALLOWED_ORIGINS = '*.itch.zone';
r = await worker.fetch(req('/ws?room=ABCDE&ver=1', { Upgrade: 'websocket', Origin: 'https://evil.example' }), env); ok('other sites refused when origins are set', r.status === 403);

function connect(q, origin) {
  return worker.fetch(req('/ws?' + q, { Upgrade: 'websocket', Origin: origin || 'https://html-classic.itch.zone' }), env).then(res => {
    const c = { res, ws: res.webSocket, msgs: [] };
    if (c.ws) { c.ws.accept(); c.ws.addEventListener('message', (e) => c.msgs.push(JSON.parse(e.data))); c.ws.addEventListener('close', () => { c.closed = true; }); }
    c.send = (m) => c.ws.send(JSON.stringify(m));
    return c;
  });
}
const a = await connect('room=abcde&name=A&ver=1&create=1'); await sleep(20);
ok('upgrade answers 101 with a socket', a.res.status === 101 && !!a.ws);
ok('lower-case codes meet in the upper-case room', a.msgs[0] && a.msgs[0].t === 'welcome' && a.msgs[0].code === 'ABCDE');
const b = await connect('room=ABCDE&name=B&ver=1&join=1'); await sleep(20);
ok('same code, same Durable Object', objects.size === 1 && b.msgs[0].t === 'welcome' && a.msgs.filter(m => m.t === 'room').pop().players.length === 2);
a.send({ t: 'start' }); await sleep(20);
ok('start reaches both', a.msgs.some(m => m.t === 'go') && b.msgs.some(m => m.t === 'go'));
b.send({ t: 'st', s: [3, 0, 0, 5, 0, 0, 1, 90, 90, 0] }); await sleep(20);
ok('relay through the object', a.msgs.some(m => m.t === 'st' && m.s[0] === 3));
const c = await connect('room=ABCDE&name=C&ver=1'); await sleep(20);
ok('late joiner told the race started, then closed', c.msgs[0] && c.msgs[0].code === 'started' && c.closed);
b.ws.close(); await sleep(20);
ok('closing a socket removes the player', a.msgs.some(m => m.t === 'left'));
a.ws.close(); await sleep(20);
ok('empty room resets', objects.get('id:ABCDE').core.players.length === 0 && objects.get('id:ABCDE').core.phase === 'lobby');
globalThis.Response = RealResponse;
console.log(`worker test: ${pass} / ${pass + fail}`);
process.exit(fail ? 1 : 0);
