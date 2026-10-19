/* 紀元前おじラン！ online race server for Cloudflare Workers (free plan: Workers + Durable Objects).
   The Worker answers a health check and hands each WebSocket to the Durable Object named after its room
   code, so everyone with the same code meets in the same room. The room logic lives in room-core.js. */
import { DurableObject } from 'cloudflare:workers';
import { RoomCore, PROTO, validCode } from './room-core.js';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
const json = (obj, status) => new Response(JSON.stringify(obj), { status: status || 200, headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, CORS) });

/* ALLOWED_ORIGINS (optional, in wrangler.toml [vars]): a comma-separated list of page origins that may connect,
   for example "https://html-classic.itch.zone, *.itch.zone". Empty means any page may connect. */
export function originAllowed(origin, list) {
  const rules = String(list || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!rules.length) return true;
  if (!origin) return false;
  let host = ''; try { host = new URL(origin).hostname; } catch (e) { return false; }
  return rules.some(r => r === origin || (r.startsWith('*.') && (host === r.slice(2) || host.endsWith(r.slice(1)))));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (url.pathname === '/' || url.pathname === '/health') return json({ ok: true, game: 'kigenzen-ojirun', proto: PROTO });
    if (url.pathname === '/ws') {
      if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') return json({ ok: false, error: 'expected a websocket' }, 426);
      if (!originAllowed(request.headers.get('Origin'), env.ALLOWED_ORIGINS)) return json({ ok: false, error: 'origin not allowed' }, 403);
      const code = String(url.searchParams.get('room') || '').toUpperCase();
      if (!validCode(code)) return json({ ok: false, error: 'bad room code' }, 400);
      const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
      return stub.fetch(request);
    }
    return json({ ok: false, error: 'not found' }, 404);
  }
};

/* One Durable Object per room code. It keeps its sockets open while the room is in use; when the last
   player leaves, nothing is left running and Cloudflare unloads it. */
export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.core = null;
  }
  async fetch(request) {
    const url = new URL(request.url);
    const code = String(url.searchParams.get('room') || '').toUpperCase();
    if (!this.core) this.core = new RoomCore(code, { now: () => Date.now(), setTimer: (ms, fn) => setTimeout(fn, ms), clearTimer: (h) => clearTimeout(h) });
    const pair = new WebSocketPair();
    const client = pair[0], server = pair[1];
    server.accept();
    const sock = { send: (s) => server.send(s), close: (c, r) => server.close(c, r) };
    const q = Object.fromEntries(url.searchParams);
    const player = this.core.join(sock, q);
    if (player) {
      let gone = false;
      const bye = () => { if (!gone) { gone = true; this.core.leave(player); } };
      server.addEventListener('message', (ev) => { if (typeof ev.data === 'string') this.core.message(player, ev.data); });
      server.addEventListener('close', bye);
      server.addEventListener('error', bye);
    }
    return new Response(null, { status: 101, webSocket: client });
  }
}
