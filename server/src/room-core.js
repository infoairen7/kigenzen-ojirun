/* 紀元前おじラン！ online rooms — the room logic, shared by the Cloudflare Durable Object (src/index.js)
   and the local Node server (dev/local-server.mjs).

   A room holds up to 6 players. Each player's game runs its own ojisan and reports where he is about ten
   times a second; the room passes those reports on to everyone else. The first player in the room is the
   host: the host's game also runs the computer rivals that fill the empty places and reports them the same
   way. The room itself never simulates the race. It keeps the roster, starts the race on a shared clock,
   relays positions and mischief items, collects finish times and sends the final order.

   Rooms whose code starts with QUICK are quick-match rooms: they start by themselves a little while after
   a second player arrives. Any other code is a private room that starts when its host presses start.

   io: { now(): ms, setTimer(ms, fn): handle, clearTimer(handle) }. A socket: { send(string), close(code, reason) }. */

export const PROTO = 1;
export const MAX_PLAYERS = 6;

export const DEFAULTS = {
  lobbyAutoMs: 20000,     // quick match: start this long after the second player joins
  fullAutoMs: 4000,       // ...or this soon once the room is full
  afterRaceAutoMs: 40000, // quick match: the next race after a race ends
  goDelayMs: 4500,        // countdown between "go" and the start
  raceMaxMs: 15 * 60000,  // a race never runs longer than this
  finishGraceMs: 90000,   // after the first finisher, the others get this long
  idleMs: 45000,          // a player who sends nothing for this long is dropped
  sweepMs: 10000
};

const ITEM_KINDS = new Set(['boomerang', 'burr', 'conch']);
const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : undefined);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100) / 100 : undefined);
const clampInt = (v, lo, hi, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };

export function cleanName(s) {
  s = String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f<>&"'`\\]/g, '').replace(/\s+/g, ' ').trim();
  return Array.from(s).slice(0, 12).join('') || 'おじさん';
}
export function validCode(code) { return typeof code === 'string' && /^[A-Z0-9]{4,8}$/.test(code); }

export class RoomCore {
  constructor(code, io, opts) {
    this.code = code; this.io = io; this.o = Object.assign({}, DEFAULTS, opts || {});
    this.players = []; this.seq = 0; this.timers = {};
    this.host = null; this.phase = 'lobby'; this.cfg = { era: 0, short: false }; this.autoAt = 0; this.race = null;
    this.pub = /^QUICK/.test(code);
  }

  /* ---------- connections ---------- */
  join(sock, q) {
    q = q || {};
    if ((parseInt(q.ver, 10) || 0) !== PROTO) return this.reject(sock, 'ver');
    if (q.create === '1' && this.players.length) return this.reject(sock, 'taken');
    if (q.join === '1' && !this.players.length) return this.reject(sock, 'noroom');
    if (this.phase !== 'lobby') return this.reject(sock, 'started');
    if (this.players.length >= MAX_PLAYERS) return this.reject(sock, 'full');
    const now = this.io.now();
    const p = { id: 'p' + (++this.seq), name: cleanName(q.name), sock, joined: now, last: now, fin: null, z: 0, rt: now, rn: 0 };
    if (!this.players.length) {
      this.host = p.id;
      this.cfg = { era: clampInt(q.era, 0, 8, 0), short: q.short === '1' };
      this.setTimer('sweep', this.o.sweepMs, () => this.sweep());
    }
    this.players.push(p);
    this.send(p, { t: 'welcome', id: p.id, code: this.code, pub: this.pub, proto: PROTO, now });
    this.broadcastRoom();
    this.checkAuto();
    return p;
  }
  reject(sock, code) {
    try { sock.send(JSON.stringify({ t: 'err', code })); } catch (e) {}
    try { sock.close(4000, code); } catch (e) {}
    return null;
  }
  leave(p) {
    const i = this.players.indexOf(p); if (i < 0) return;
    this.players.splice(i, 1);
    if (!this.players.length) { this.reset(); return; }
    if (this.host === p.id) this.host = this.players[0].id;
    this.broadcast({ t: 'left', id: p.id, host: this.host });
    this.broadcastRoom();
    if (this.phase === 'race') this.checkEnd();
    this.checkAuto();
  }
  reset() {
    for (const k of Object.keys(this.timers)) this.clearTimer(k);
    this.phase = 'lobby'; this.race = null; this.autoAt = 0; this.host = null;
  }

  /* ---------- messages from a player ---------- */
  message(p, raw) {
    if (typeof raw !== 'string' || raw.length > 4096 || this.players.indexOf(p) < 0) return;
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m.t !== 'string') return;
    const now = this.io.now(); p.last = now;
    if (now - p.rt > 1000) { p.rt = now; p.rn = 0; }
    if (++p.rn > 45) return;   // flood guard: a game sends about 10–20 a second
    switch (m.t) {
      case 'ping': this.send(p, { t: 'pong', c: num(m.c), s: now }); return;
      case 'cfg':
        if (p.id !== this.host || this.phase !== 'lobby') return;
        this.cfg = { era: clampInt(m.era, 0, 8, this.cfg.era), short: !!m.short };
        this.broadcastRoom(); return;
      case 'start': if (p.id === this.host && this.phase === 'lobby') this.startRace(); return;
      case 'st':   // my ojisan: [z, x, y, vz, vx, vy, flags, stamina, flame, cp, finishTime]
        if (this.phase !== 'race' || !Array.isArray(m.s) || m.s.length > 16) return;
        p.z = num(m.s[0]) || 0;
        this.relay(p, { t: 'st', id: p.id, s: m.s.map(num) }); return;
      case 'npc':  // the host's computer rivals: [[index, ...same fields as st], ...]
        if (this.phase !== 'race' || p.id !== this.host || !Array.isArray(m.b) || m.b.length > MAX_PLAYERS) return;
        this.relay(p, { t: 'npc', b: m.b.filter(Array.isArray).map(a => a.slice(0, 16).map(num)) }); return;
      case 'it': {  // someone used an item
        if (this.phase !== 'race' || !ITEM_KINDS.has(m.k)) return;
        this.relay(p, { t: 'it', from: p.id, k: m.k, u: str(m.u, 8), to: str(m.to, 8), x: num(m.x), y: num(m.y), z: num(m.z), d: num(m.d), id: str(m.id, 16) }); return;
      }
      case 'bg':   // a chestnut on the ground was stepped on
        if (this.phase === 'race') this.relay(p, { t: 'bg', from: p.id, id: str(m.id, 16), u: str(m.u, 8) }); return;
      case 'hr':   // a hit landed (or a wig blocked it): tells the thrower
        if (this.phase === 'race') this.relay(p, { t: 'hr', from: p.id, to: str(m.to, 8), u: str(m.u, 8), k: ITEM_KINDS.has(m.k) ? m.k : undefined, w: !!m.w }); return;
      case 'fin':
        if (this.phase !== 'race' || p.fin) return;
        p.fin = { time: num(m.time) || 0, deaths: clampInt(m.deaths, 0, 9999, 0) };
        this.broadcast({ t: 'fin', id: p.id, time: p.fin.time, deaths: p.fin.deaths });
        this.checkEnd(); return;
      case 'leave': try { p.sock.close(1000, 'bye'); } catch (e) {} this.leave(p); return;
    }
  }

  /* ---------- race flow ---------- */
  startRace() {
    this.clearTimer('auto'); this.autoAt = 0;
    const now = this.io.now(), at = now + this.o.goDelayMs;
    this.phase = 'race'; this.race = { at };
    for (const q of this.players) { q.fin = null; q.z = 0; }
    this.broadcast({ t: 'go', at, now, cfg: this.cfg, host: this.host, order: this.players.map(q => ({ id: q.id, name: q.name })), bots: MAX_PLAYERS - this.players.length });
    this.setTimer('raceMax', this.o.goDelayMs + this.o.raceMaxMs, () => this.endRace('timeout'));
  }
  checkEnd() {
    if (this.phase !== 'race') return;
    if (this.players.every(q => q.fin)) return this.endRace('done');
    if (this.players.some(q => q.fin) && !this.timers.grace) this.setTimer('grace', this.o.finishGraceMs, () => this.endRace('grace'));
  }
  endRace(why) {
    if (this.phase !== 'race') return;
    this.clearTimer('raceMax'); this.clearTimer('grace');
    const list = this.players.map(q => ({ id: q.id, name: q.name, time: q.fin ? q.fin.time : null, z: q.z }))
      .sort((a, b) => (a.time != null && b.time != null) ? a.time - b.time : a.time != null ? -1 : b.time != null ? 1 : b.z - a.z);
    this.phase = 'lobby'; this.race = null;
    for (const q of this.players) { q.fin = null; q.z = 0; }
    this.broadcast({ t: 'results', why, list });
    this.checkAuto(this.o.afterRaceAutoMs);
    this.broadcastRoom();
  }
  checkAuto(wait) {
    if (this.phase !== 'lobby' || !this.pub) return;
    const n = this.players.length, now = this.io.now();
    if (n < 2) { if (this.autoAt) { this.clearTimer('auto'); this.autoAt = 0; this.broadcastRoom(); } return; }
    const want = now + (n >= MAX_PLAYERS ? this.o.fullAutoMs : (wait || this.o.lobbyAutoMs));
    if (this.autoAt && this.autoAt <= want) return;
    this.autoAt = want;
    this.setTimer('auto', want - now, () => { this.autoAt = 0; if (this.phase === 'lobby' && this.players.length) this.startRace(); });
    this.broadcastRoom();
  }
  sweep() {
    const now = this.io.now();
    for (const p of this.players.slice()) if (now - p.last > this.o.idleMs) { try { p.sock.close(4001, 'idle'); } catch (e) {} this.leave(p); }
    if (this.players.length) this.setTimer('sweep', this.o.sweepMs, () => this.sweep());
  }

  /* ---------- sending ---------- */
  roomMsg() {
    return { t: 'room', code: this.code, pub: this.pub, host: this.host, phase: this.phase, cfg: this.cfg, autoAt: this.autoAt, now: this.io.now(), max: MAX_PLAYERS,
      players: this.players.map(q => ({ id: q.id, name: q.name, fin: !!q.fin })) };
  }
  broadcastRoom() { this.broadcast(this.roomMsg()); }
  send(p, msg) { try { p.sock.send(JSON.stringify(msg)); } catch (e) {} }
  broadcast(msg) { const s = JSON.stringify(msg); for (const q of this.players) { try { q.sock.send(s); } catch (e) {} } }
  relay(from, msg) { const s = JSON.stringify(msg); for (const q of this.players) if (q !== from) { try { q.sock.send(s); } catch (e) {} } }
  setTimer(name, ms, fn) { this.clearTimer(name); this.timers[name] = this.io.setTimer(ms, () => { delete this.timers[name]; fn(); }); }
  clearTimer(name) { if (this.timers[name] != null) { this.io.clearTimer(this.timers[name]); delete this.timers[name]; } }
}
