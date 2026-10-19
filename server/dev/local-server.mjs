#!/usr/bin/env node
/* 紀元前おじラン！ — the online race server on your own computer (Node 18+, no packages needed).
   Uses the same room logic as the Cloudflare version. Good for testing and for playing on a home network.

     node dev/local-server.mjs                      → ws://localhost:8787
     node dev/local-server.mjs --port 9000
     node dev/local-server.mjs --game ../dist/index.html
         also serves the game at http://<this computer>:8787/ , already pointed at this server,
         so everyone on the same Wi-Fi can open that address and race.
     node dev/local-server.mjs --game ../dist/index.html --p2p
         the same, but the games race browser to browser (as on the web) and this computer stands in for
         the public PeerJS broker at /peerjs, so it works on a network with no internet. */
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RoomCore, PROTO, validCode } from '../src/room-core.js';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const PORT = parseInt(arg('--port', process.env.PORT || '8787'), 10);
const HOST = arg('--host', '0.0.0.0');
const GAME = arg('--game', '');
const FAST = args.includes('--fast');   // tests: short timers
const P2P = args.includes('--p2p');     // --game: browser-to-browser rooms through the broker below
const here = path.dirname(fileURLToPath(import.meta.url));

const opts = FAST ? { lobbyAutoMs: 1500, fullAutoMs: 800, afterRaceAutoMs: 3000, goDelayMs: 1500, finishGraceMs: 15000, idleMs: 8000, sweepMs: 1000 } : {};
const rooms = new Map();
const io = { now: () => Date.now(), setTimer: (ms, fn) => setTimeout(fn, ms), clearTimer: (h) => clearTimeout(h) };
function room(code) { let r = rooms.get(code); if (!r) { r = new RoomCore(code, io, opts); rooms.set(code, r); } return r; }
setInterval(() => { for (const [k, r] of rooms) if (!r.players.length) rooms.delete(k); }, 60000).unref();

/* ---------- a minimal WebSocket server (RFC 6455: text frames, ping/pong, close) ---------- */
function frame(op, payload) {
  const n = payload.length; let head;
  if (n < 126) head = Buffer.from([0x80 | op, n]);
  else if (n < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | op; head[1] = 126; head.writeUInt16BE(n, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x80 | op; head[1] = 127; head.writeBigUInt64BE(BigInt(n), 2); }
  return Buffer.concat([head, payload]);
}
function acceptWebSocket(req, socket, head) {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return null; }
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  socket.setNoDelay(true);
  let buf = head && head.length ? Buffer.from(head) : Buffer.alloc(0), parts = [], partOp = 0, closed = false, fired = false;
  const ws = {
    onmessage: null, onclose: null,
    send(s) { if (!closed) socket.write(frame(1, Buffer.from(String(s), 'utf8'))); },
    close(code, reason) {
      if (closed) return; closed = true;
      const r = Buffer.from(String(reason || '').slice(0, 100), 'utf8'), b = Buffer.alloc(2 + r.length); b.writeUInt16BE(code || 1000, 0); r.copy(b, 2);
      try { socket.write(frame(8, b)); socket.end(); } catch (e) {}
      fire();
    }
  };
  const fire = () => { if (!fired) { fired = true; if (ws.onclose) ws.onclose(); } };
  socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 2) {
      const b0 = buf[0], b1 = buf[1], fin = b0 & 0x80, op = b0 & 0x0f, masked = b1 & 0x80;
      let len = b1 & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      if (len > 1 << 20) { socket.destroy(); return; }
      const ml = masked ? 4 : 0; if (buf.length < off + ml + len) return;
      let data = Buffer.from(buf.subarray(off + ml, off + ml + len));
      if (masked) { const m = buf.subarray(off, off + 4); for (let i = 0; i < data.length; i++) data[i] ^= m[i & 3]; }
      buf = buf.subarray(off + ml + len);
      if (op === 8) { if (!closed) { closed = true; try { socket.write(frame(8, data.subarray(0, 2))); socket.end(); } catch (e) {} } fire(); return; }
      if (op === 9) { if (!closed) socket.write(frame(10, data)); continue; }
      if (op === 10) continue;
      if (op === 1 || op === 2) { partOp = op; parts = []; }
      parts.push(data);
      if (fin) { const msg = Buffer.concat(parts); parts = []; if (partOp === 1 && ws.onmessage) ws.onmessage(msg.toString('utf8')); }
    }
  });
  socket.on('close', fire);
  socket.on('error', () => { try { socket.destroy(); } catch (e) {} fire(); });
  return ws;
}

/* ---------- HTTP ---------- */
let gameHTML = null, gameDir = '';
const TYPES = { '.js': 'application/javascript', '.txt': 'text/plain; charset=utf-8', '.png': 'image/png', '.json': 'application/json' };
if (GAME) {
  const file = path.resolve(process.cwd(), GAME); gameDir = path.dirname(file);
  const html = fs.readFileSync(file, 'utf8');
  const inject = P2P ? "<script>window.TORCH_PEER = { host: location.hostname, port: +location.port || (location.protocol === 'https:' ? 443 : 80), secure: location.protocol === 'https:' };</script>"
    : "<script>window.TORCH_SERVER = location.origin.replace(/^http/, 'ws');</script>";
  gameHTML = html.includes('<head>') ? html.replace('<head>', '<head>' + inject) : inject + html;
  console.log('serving the game from', file);
}
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (url.pathname === '/health' || (url.pathname === '/' && !gameHTML)) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, game: 'kigenzen-ojirun', proto: PROTO, local: true })); return; }
  if ((url.pathname === '/' || url.pathname === '/index.html') && gameHTML) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(gameHTML); return; }
  if (gameHTML && /^\/[A-Za-z0-9._-]+$/.test(url.pathname) && !url.pathname.startsWith('/.')) {   // files next to the game (three.min.js)
    const f = path.join(gameDir, url.pathname.slice(1));
    if (fs.existsSync(f) && fs.statSync(f).isFile()) { res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); return; }
  }
  res.writeHead(404, { 'Content-Type': 'application/json' }); res.end('{"ok":false}');
});
/* ---------- a stand-in for the PeerJS broker (PeerServer protocol), for browser-to-browser rooms ----------
   Each game holds one WebSocket here under its id. OFFER / ANSWER / CANDIDATE go to "dst"; a message for an id
   that is not here waits a moment, then the sender gets EXPIRE. */
const peers = new Map(), waiting = new Map(), EXPIRE_MS = FAST ? 1500 : 5000;
function broker(url, req, socket, head) {
  const id = url.searchParams.get('id') || '', token = url.searchParams.get('token') || '', key = url.searchParams.get('key') || '';
  const ws = acceptWebSocket(req, socket, head); if (!ws) return;
  if (!id || !token || !key) { ws.send(JSON.stringify({ type: 'ERROR', payload: { msg: 'No id, token, or key supplied to websocket server' } })); ws.close(1000); return; }
  const cur = peers.get(id);
  if (cur && cur.token !== token) { ws.send(JSON.stringify({ type: 'ID-TAKEN', payload: { msg: 'ID is taken' } })); ws.close(1000); return; }
  const me = { id, token, ws }; peers.set(id, me);
  if (!cur) ws.send('{"type":"OPEN"}');
  const w = waiting.get(id); if (w) { waiting.delete(id); for (const e of w) ws.send(JSON.stringify(e.msg)); }
  ws.onmessage = (s) => {
    let m; try { m = JSON.parse(s); } catch (e) { return; }
    if (!m || !['OFFER', 'ANSWER', 'CANDIDATE', 'LEAVE', 'EXPIRE'].includes(m.type)) return;
    const msg = { type: m.type, src: id, dst: m.dst, payload: m.payload }, to = peers.get(m.dst);
    if (to) to.ws.send(JSON.stringify(msg));
    else if (m.dst && m.type !== 'LEAVE' && m.type !== 'EXPIRE') { const l = waiting.get(m.dst) || []; l.push({ msg, at: Date.now() }); waiting.set(m.dst, l); }
  };
  ws.onclose = () => { if (peers.get(id) === me) peers.delete(id); };
}
setInterval(() => {
  const now = Date.now();
  for (const [dst, l] of waiting) {
    if (now - l[0].at < EXPIRE_MS) continue;
    waiting.delete(dst);
    for (const src of new Set(l.map(e => e.msg.src))) { const p = peers.get(src); if (p) p.ws.send(JSON.stringify({ type: 'EXPIRE', src: dst, dst: src })); }
  }
}, 500).unref();

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/peerjs') { broker(url, req, socket, head); return; }
  const code = String(url.searchParams.get('room') || '').toUpperCase();
  if (url.pathname !== '/ws' || !validCode(code)) { socket.write('HTTP/1.1 400 Bad Request\r\n\r\n'); socket.destroy(); return; }
  const ws = acceptWebSocket(req, socket, head); if (!ws) return;
  const r = room(code);
  const p = r.join({ send: (s) => ws.send(s), close: (c, why) => ws.close(c, why) }, Object.fromEntries(url.searchParams));
  if (!p) return;
  ws.onmessage = (s) => r.message(p, s);
  ws.onclose = () => r.leave(p);
});
server.listen(PORT, HOST, () => {
  console.log('紀元前おじラン！ online server: ws://localhost:' + PORT + (FAST ? '  (fast timers)' : ''));
  if (GAME) console.log('game: http://localhost:' + PORT + '/   (others on your network: http://<this computer\'s address>:' + PORT + '/)' + (P2P ? '  browser to browser' : ''));
});
