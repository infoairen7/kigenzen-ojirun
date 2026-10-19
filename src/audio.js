/* 紀元前おじラン！ — audio module.
   Everything here is synthesized in code: no recorded samples, no external files, so nothing to license.
   1) VOICE  — a Klatt-style cascade formant synthesizer that speaks short kana lines (ojisan, rivals, chants, choir).
   2) ENGINE — Web Audio graph: adaptive orchestral BGM (taiko, strings, brass, sampled choir), SFX, ambience, ducking.
   No DOM and no THREE: it also runs in Node (voice) and in an OfflineAudioContext (tests, listening sample). */
(function (global) {
'use strict';
const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
function prng(seed) { let a = (seed >>> 0) || 1; return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function curve(points, x) { // piecewise-linear [[x, y], ...]
  if (!points || !points.length) return 1;
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) if (x <= points[i][0]) { const a = points[i - 1], b = points[i]; return lerp(a[1], b[1], (x - a[0]) / Math.max(1e-9, b[0] - a[0])); }
  return points[points.length - 1][1];
}

/* =====================================================================================
   VOICE
   ===================================================================================== */
// Vowel targets for an adult male: F1..F4 (Hz), B1..B4 (Hz). Bandwidths are on the wide side of measured values —
// narrow ones make formants ring, which is a big part of what sounds "synthetic".
const VOW = {
  a: [760, 1220, 2500, 3500, 100, 120, 200, 300],
  i: [290, 2200, 2900, 3600, 70, 130, 250, 320],
  u: [330, 1380, 2350, 3400, 80, 120, 200, 300],
  e: [470, 1900, 2550, 3500, 80, 120, 210, 300],
  o: [500, 860, 2450, 3400, 90, 110, 190, 300],
  x: [520, 1480, 2480, 3450, 110, 140, 220, 320],   // relaxed neutral mouth (breaths, sighs)
  N: [260, 1250, 2350, 3400, 100, 300, 300, 320],   // ん (closed mouth hum)
  m: [250, 1000, 2300, 3400, 100, 300, 300, 320],
  n: [250, 1450, 2400, 3400, 100, 300, 300, 320]
};
const KANA = {};
{ const rows = { '': 'あいうえお', k: 'かきくけこ', g: 'がぎぐげご', s: 'さしすせそ', z: 'ざじずぜぞ', t: 'たちつてと', d: 'だぢづでど',
    n: 'なにぬねの', h: 'はひふへほ', b: 'ばびぶべぼ', p: 'ぱぴぷぺぽ', m: 'まみむめも', r: 'らりるれろ' };
  for (const c in rows) for (let i = 0; i < 5; i++) KANA[rows[c][i]] = [c, 'aiueo'[i]];
  Object.assign(KANA, { 'し': ['sh', 'i'], 'じ': ['j', 'i'], 'ち': ['ch', 'i'], 'つ': ['ts', 'u'], 'ぢ': ['j', 'i'], 'づ': ['z', 'u'], 'ひ': ['hy', 'i'], 'ふ': ['f', 'u'],
    'や': ['y', 'a'], 'ゆ': ['y', 'u'], 'よ': ['y', 'o'], 'わ': ['w', 'a'], 'を': ['', 'o'], 'ん': ['N', 'N'] }); }
const SMALL_Y = { 'ゃ': 'a', 'ゅ': 'u', 'ょ': 'o' }, SMALL_V = { 'ぁ': 'a', 'ぃ': 'i', 'ぅ': 'u', 'ぇ': 'e', 'ぉ': 'o' };
const PAL = { k: 'ky', g: 'gy', sh: 'sh', j: 'j', ch: 'ch', n: 'ny', hy: 'hy', b: 'by', p: 'py', m: 'my', r: 'ry' };
const VOICELESS = { k: 1, ky: 1, s: 1, sh: 1, t: 1, ch: 1, ts: 1, h: 1, hy: 1, f: 1, p: 1, py: 1 };
const DEVOICERS = { k: 1, ky: 1, s: 1, sh: 1, t: 1, ch: 1, ts: 1, p: 1, py: 1, f: 1 };

function parseKana(text) {
  const out = [];
  const s = String(text).replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
  for (const ch of s) {
    const last = out.length ? out[out.length - 1] : null;
    if (KANA[ch]) { out.push({ c: KANA[ch][0], v: KANA[ch][1], len: 1 }); continue; }
    if (SMALL_Y[ch] && last && last.v) { if (PAL[last.c]) { last.c = PAL[last.c]; last.v = SMALL_Y[ch]; } else out.push({ c: 'y', v: SMALL_Y[ch], len: 1 }); continue; }
    if (SMALL_V[ch] && last && last.v) {
      if (last.c && last.c !== 'N' && (last.v === 'u' || last.v === 'i') && last.len === 1 && !last.glide) last.v = SMALL_V[ch];
      else if (SMALL_V[ch] === last.v) last.len += 1;            // ぁ after あ-column: lengthen
      else out.push({ c: '', v: SMALL_V[ch], len: 1, glide: true });
      continue;
    }
    if (ch === 'っ') { out.push({ gem: true }); continue; }
    if ((ch === 'ー' || ch === '〜' || ch === '~') && last && last.v) { last.len += 1; if (ch !== 'ー') last.wob = true; continue; }
    if (ch === '…') { out.push({ trail: true }); continue; }
    if (ch === '、' || ch === ' ' || ch === '　') { out.push({ pause: 0.09 }); continue; }
  }
  // devoicing: i/u after a voiceless consonant before っ or at the very end
  for (let i = 0; i < out.length; i++) {
    const m = out[i]; if (!m.v || !DEVOICERS[m.c] || (m.v !== 'i' && m.v !== 'u') || m.len > 1) continue;
    const nx = out[i + 1];
    if (!nx || nx.gem || nx.trail) m.devoice = true;
  }
  return out;
}

const PROFILES = {
  ojisan:  { f0: 112, vt: 0.94, breath: 0.20, rough: 0.12, jitter: 0.012, rate: 1 },
  gen:     { f0: 92,  vt: 0.90, breath: 0.14, rough: 0.18, jitter: 0.010, rate: 0.95 },
  takeshi: { f0: 140, vt: 1.00, breath: 0.10, rough: 0.04, jitter: 0.008, rate: 1.1 },
  masao:   { f0: 120, vt: 0.97, breath: 0.28, rough: 0.06, jitter: 0.010, rate: 0.95 },
  noboru:  { f0: 106, vt: 0.95, breath: 0.32, rough: 0.25, jitter: 0.022, rate: 0.85 },
  hiroshi: { f0: 100, vt: 0.93, breath: 0.38, rough: 0.10, jitter: 0.012, rate: 0.9 }
};

/* Lines. The voice no longer tries to pronounce words (formant synthesis always sounds robotic on words);
   it makes the sounds a person makes without words — breaths, effort grunts, gasps, laughs, sighs, a closed-mouth hum —
   and the words go in the speech bubble. Each design is a list of segments S(duration, targets): the values ramp from
   the previous segment's to these targets (v = mouth shape, av = voicing, ah = breath noise, af/ff/bf = lip/teeth hiss,
   f0 = pitch × the speaker's base pitch, burst = a short release click). Each design is rendered `vars` times with
   small random differences so repeated sounds are never identical. t = label for the sound test, b = bubble text. */
const S = (d, o) => Object.assign({ d }, o || {});
function laughSeg(n, p0, step, open) {   // "ha" pulses for a laugh
  const out = [];
  for (let i = 0; i < n; i++) { const p = p0 - i * step; out.push(S(0.02, { v: open || 'a', ah: 0.55, av: 0.1, f0: p + 0.03 }), S(0.05, { ah: 0.32, av: 0.62, f0: p }), S(0.045 + i * 0.006, { ah: 0.08, av: 0.03, f0: p - 0.08 })); }
  out.push(S(0.04, { ah: 0, av: 0 })); return out;
}
const LINES = {
  breath:    { t: 'はっ…すぅ', pri: 0, gain: 0.16, breath: 0.55, vars: 3, v: [
    [S(.016, { v: 'x', ah: .55, av: .03, f0: 1 }), S(.05, { ah: .7, av: .09, f0: 1 }), S(.09, { ah: .22, av: .01, f0: .93 }), S(.04, { ah: 0, av: 0, f0: .9 }), S(.06), S(.045, { v: 'e', ah: .15 }), S(.08, { ah: .2 }), S(.05, { ah: 0 })],
    [S(.016, { v: 'u', ah: .4, af: .05, ff: 1500, bf: 2500 }), S(.06, { ah: .55, af: .07 }), S(.09, { ah: .14, af: .02 }), S(.04, { ah: 0, af: 0 })]] },
  tired:     { t: 'はぁっ…ひぃ', pri: 0, gain: 0.28, breath: 0.45, creak: 0.45, vars: 3, v: [
    [S(.02, { v: 'a', ah: .55, av: .1, f0: .95 }), S(.07, { ah: .55, av: .4, f0: .96 }), S(.13, { ah: .3, av: .18, f0: .8 }), S(.05, { ah: 0, av: 0, f0: .75 }), S(.08), S(.05, { v: 'i', ah: .2, af: .04, ff: 2900, bf: 600 }), S(.1, { ah: .26, af: .06 }), S(.05, { ah: 0, af: 0 })],
    [S(.02, { v: 'x', ah: .55, av: .08, f0: .9 }), S(.08, { ah: .5, av: .35, f0: .9 }), S(.18, { ah: .25, av: .12, f0: .72 }), S(.05, { ah: 0, av: 0 })]] },
  breathWig: { t: 'ほっ', pri: 0, gain: 0.26, press: 0.4, vars: 3, v: [
    [S(.015, { v: 'o', ah: .45, av: .2, f0: 1.3 }), S(.05, { ah: .3, av: .75, f0: 1.38 }), S(.07, { ah: .18, av: .25, f0: 1.2 }), S(.03, { ah: 0, av: 0, f0: 1.1 })]] },
  grunt:     { t: 'んっ', pri: 1, gain: 0.45, press: 0.75, rough: 0.15, vars: 3, v: [
    [S(.012, { v: 'N', av: .35, ah: .08, f0: 1.15 }), S(.09, { av: 1, ah: .1, f0: 1.32 }), S(.03, { av: .2, ah: .05, f0: 1.12 }), S(.02, { av: 0, ah: 0, f0: 1.05 })]] },
  jump:      { t: 'ほっ / はっ / ふっ', pri: 1, gain: 0.48, press: 0.45, vars: 2, v: [
    [S(.012, { v: 'o', ah: .55, av: .15, f0: 1.28 }), S(.04, { ah: .35, av: .7, f0: 1.45 }), S(.06, { ah: .22, av: .25, f0: 1.25 }), S(.035, { ah: 0, av: 0, f0: 1.15 })],
    [S(.012, { v: 'a', ah: .55, av: .15, f0: 1.3 }), S(.04, { ah: .35, av: .7, f0: 1.5 }), S(.06, { ah: .22, av: .25, f0: 1.28 }), S(.035, { ah: 0, av: 0, f0: 1.18 })],
    [S(.012, { v: 'u', ah: .4, af: .08, ff: 1500, bf: 2500, av: .1, f0: 1.25 }), S(.04, { ah: .3, af: .05, av: .6, f0: 1.4 }), S(.06, { ah: .18, af: 0, av: .2, f0: 1.2 }), S(.03, { ah: 0, av: 0 })]] },
  ember:     { t: 'おっ / ほぉ', pri: 1, gain: 0.45, vars: 2, b: ['よしっ', '燃えろっ'], v: [
    [S(.02, { v: 'o', ah: .3, av: .2, f0: 1.25 }), S(.05, { av: .75, ah: .2, f0: 1.3 }), S(.11, { av: .65, ah: .18, f0: 1.62 }), S(.05, { av: .1, ah: .1, f0: 1.55 }), S(.03, { av: 0, ah: 0 })],
    [S(.03, { v: 'o', ah: .5, av: .05, f0: 1.3 }), S(.06, { ah: .35, av: .6, f0: 1.35 }), S(.18, { ah: .25, av: .55, f0: 1.15 }), S(.06, { av: 0, ah: 0, f0: 1.05 })]] },
  shoes:     { t: 'はぁ〜（ひと息）', pri: 2, gain: 0.4, breath: 0.3, creak: 0.3, vars: 2, b: '休める…', v: [
    [S(.03, { v: 'a', ah: .55, av: .05, f0: 1.2 }), S(.1, { ah: .5, av: .35, f0: 1.25 }), S(.32, { ah: .42, av: .28, f0: .98 }), S(.22, { ah: .18, av: .04, f0: .82 }), S(.06, { ah: 0, av: 0 })]] },
  shoesEnd:  { t: 'ふんっ', pri: 1, gain: 0.4, press: 0.5, vars: 2, b: 'また走るか', v: [
    [S(.015, { v: 'u', ah: .35, af: .06, ff: 1500, bf: 2500, av: 0, f0: 1.1 }), S(.04, { ah: .2, af: 0, av: 0 }), S(.012, { v: 'N', av: .3, f0: 1.1 }), S(.08, { av: .85, ah: .08, f0: 1.25 }), S(.03, { av: 0, ah: 0 })]] },
  meat:      { t: 'んん〜まっ', pri: 2, gain: 0.45, vars: 2, b: 'うまっ！', v: [
    [S(.03, { v: 'm', av: .3, ah: .05, f0: 1.2 }), S(.22, { av: .75, ah: .06, f0: 1.5 }), S(.025, { av: .4, f0: 1.45 }), S(.012, { v: 'a', av: .8, ah: .15, f0: 1.6, burst: { a: .3, f: 900, bw: 1400, d: .006 } }), S(.07, { av: .55, ah: .18, f0: 1.5 }), S(.04, { av: 0, ah: 0, f0: 1.4 })]] },
  wigGet:    { t: 'おおっ！', pri: 3, gain: 0.62, press: 0.75, vib: [0.025, 5.5], vars: 2, b: '髪が…ある！', v: [
    [S(.03, { v: 'o', ah: .35, av: .35, f0: 1.45 }), S(.12, { av: 1, ah: .25, f0: 1.75 }), S(.22, { av: 1, ah: .3, f0: 2.0 }), S(.05, { v: 'a', av: .8, ah: .3, f0: 1.95 }), S(.05, { av: 0, ah: .12, f0: 1.8 }), S(.03, { ah: 0 })]] },
  wigLaugh:  { t: 'ふはははっ', pri: 2, gain: 0.5, breath: 0.3, vars: 2, b: '見よ、この髪！', v: [
    [S(.04, { v: 'u', ah: .4, af: .08, ff: 1500, bf: 2500, av: 0, f0: 1.4 }), S(.03, { ah: .1, af: 0 })].concat(laughSeg(4, 1.62, 0.06))] },
  wigLost:   { t: 'ひっ（息をのむ）', pri: 3, gain: 0.42, vars: 2, b: 'あっ', v: [
    [S(.01, { v: 'i', ah: .45, av: 0, f0: 1.9 }), S(.05, { ah: .55, av: .2, f0: 2.05 }), S(.04, { ah: .15, av: 0, f0: 1.9 }), S(.02, { ah: 0 })]] },
  drink:     { t: 'ぷはぁ〜', pri: 2, gain: 0.45, creak: 0.2, vars: 2, b: '飲んじゃった', v: [
    [S(.03, { v: 'a', av: 0, ah: 0 }), S(.01, { ah: .3, burst: { a: .55, f: 800, bw: 1500, d: .008 } }), S(.08, { ah: .55, av: .35, f0: 1.35 }), S(.28, { ah: .45, av: .38, f0: 1.1 }), S(.2, { ah: .22, av: .08, f0: .9 }), S(.06, { ah: 0, av: 0 })]] },
  hic:       { t: 'ひっく', pri: 1, gain: 0.38, press: 0.6, vars: 2, b: 'ひっく', v: [
    [S(.008, { v: 'i', av: .8, ah: .2, f0: 2.1 }), S(.05, { av: .55, ah: .15, f0: 2.25 }), S(.01, { av: 0, ah: 0 }), S(.04), S(.01, { ah: .2, burst: { a: .35, f: 1800, bw: 900, d: .012 } }), S(.03, { ah: 0 })]] },
  hit:       { t: 'うっ / ぐっ', pri: 3, gain: 0.55, press: 0.8, rough: 0.25, vars: 2, b: ['いてっ', 'ぐぇっ'], v: [
    [S(.01, { v: 'u', av: .55, ah: .2, f0: 1.45 }), S(.07, { av: 1, ah: .15, f0: 1.62 }), S(.05, { av: .45, ah: .1, f0: 1.3 }), S(.02, { av: 0, ah: 0 })],
    [S(.012, { v: 'u', av: .1, burst: { a: .3, f: 1700, bw: 900, d: .012 } }), S(.06, { av: 1, ah: .2, f0: 1.5 }), S(.06, { v: 'x', av: .4, ah: .15, f0: 1.2 }), S(.02, { av: 0, ah: 0 })]] },
  water:     { t: 'ひゃっ', pri: 3, gain: 0.48, vars: 2, b: ['ひゃっ', '冷たっ！'], v: [
    [S(.01, { v: 'i', ah: .55, av: 0, f0: 2.0 }), S(.035, { ah: .6, av: .25, f0: 2.1 }), S(.05, { v: 'a', ah: .35, av: .45, f0: 2.2 }), S(.03, { ah: 0, av: 0, f0: 2.0 })]] },
  flameLow:  { t: 'うぅ…', pri: 2, gain: 0.4, vib: [0.04, 7], vars: 2, b: '火が…！', v: [
    [S(.03, { v: 'u', av: .35, ah: .3, f0: 1.45 }), S(.18, { av: .6, ah: .3, f0: 1.55 }), S(.2, { av: .4, ah: .25, f0: 1.3 }), S(.07, { av: 0, ah: 0 })]] },
  flameOut:  { t: 'あぁぁ…', pri: 4, gain: 0.5, creak: 0.55, vars: 2, b: '火が…', v: [
    [S(.03, { v: 'a', av: .45, ah: .4, f0: 1.5 }), S(.22, { av: .85, ah: .35, f0: 1.58 }), S(.32, { av: .5, ah: .35, f0: 1.12 }), S(.2, { av: .1, ah: .15, f0: .86 }), S(.05, { av: 0, ah: 0 })]] },
  fall:      { t: 'うわぁぁ…', pri: 4, gain: 0.62, press: 0.75, vib: [0.04, 6], vars: 2, b: 'うわぁぁ', v: [
    [S(.03, { v: 'u', av: .6, ah: .4, f0: 2.0 }), S(.1, { av: 1, ah: .3, f0: 2.3 }), S(.05, { v: 'a', av: 1, ah: .35, f0: 2.3 }), S(.5, { av: 1, ah: .35, f0: 2.2 }), S(.25, { av: .5, ah: .3, f0: 1.6 }), S(.06, { av: 0, ah: 0, f0: 1.4 })]] },
  gate:      { t: 'ふぅ〜', pri: 2, gain: 0.38, vars: 2, b: 'ふぅ…', v: [
    [S(.04, { v: 'u', ah: .45, af: .1, ff: 1400, bf: 2600, av: 0, f0: 1.15 }), S(.25, { ah: .42, af: .07, av: .12, f0: 1.05 }), S(.25, { ah: .18, af: .02, av: .02, f0: .9 }), S(.06, { ah: 0, af: 0, av: 0 })]] },
  resume:    { t: 'んん〜っ…ふぅ', pri: 2, gain: 0.45, press: 0.5, vars: 2, b: 'よっこらしょ', v: [
    [S(.03, { v: 'N', av: .35, ah: .05, f0: 1.0 }), S(.28, { av: .8, ah: .08, f0: 1.25 }), S(.07, { av: .3, ah: .05, f0: 1.05 }), S(.02, { av: 0, ah: 0 }), S(.07), S(.02, { v: 'x', ah: .45, av: .05 }), S(.14, { ah: .3, av: .03, f0: .9 }), S(.05, { ah: 0, av: 0 })]] },
  start:     { t: 'すぅ…ふんっ', pri: 2, gain: 0.45, press: 0.6, vars: 2, b: 'よーし…', v: [
    [S(.05, { v: 'x', ah: .15 }), S(.2, { ah: .22 }), S(.05, { ah: 0 }), S(.05), S(.012, { v: 'N', av: .35, f0: 1.1 }), S(.09, { av: 1, ah: .08, f0: 1.28 }), S(.03, { av: 0, ah: 0, f0: 1.1 })]] },
  retry:     { t: 'んしょ', pri: 2, gain: 0.42, vars: 2, b: 'よいしょ…', v: [
    [S(.012, { v: 'N', av: .35, f0: 1.05 }), S(.12, { av: .85, ah: .08, f0: 1.22 }), S(.03, { av: .1 }), S(.06, { v: 'o', av: 0, af: .35, ff: 2700, bf: 1600 }), S(.04, { av: .6, af: 0, ah: .15, f0: 1.0 }), S(.06, { av: 0, ah: 0, f0: .92 })]] },
  rescue:    { t: 'はぁっ（安堵）', pri: 3, gain: 0.42, vars: 2, b: 'あぶなっ', v: [
    [S(.02, { v: 'a', ah: .6, av: .05, f0: 1.4 }), S(.09, { ah: .55, av: .32, f0: 1.42 }), S(.14, { ah: .28, av: .08, f0: 1.0 }), S(.05, { ah: 0, av: 0 })]] },
  overtake:  { t: 'ふふん', pri: 2, gain: 0.42, vars: 2, b: 'お先っ！', v: [
    [S(.03, { v: 'u', ah: .4, af: .08, ff: 1500, bf: 2500, av: 0, f0: 1.25 }), S(.035, { ah: .1, af: 0 }), S(.025, { ah: .4, af: .08 }), S(.03, { ah: .05, af: 0 }), S(.012, { v: 'N', av: .4, f0: 1.2 }), S(.15, { av: .75, ah: .06, f0: 1.45 }), S(.05, { av: 0, ah: 0, f0: 1.4 })]] },
  overtaken: { t: 'えっ!?', pri: 2, gain: 0.48, press: 0.5, vars: 2, b: 'なにっ!?', v: [
    [S(.012, { v: 'e', av: .45, ah: .2, f0: 1.4 }), S(.11, { av: .9, ah: .2, f0: 1.92 }), S(.035, { av: 0, ah: .08, f0: 1.95 }), S(.02, { ah: 0 })]] },
  passed:    { t: 'ちっ…ん / ぐぬ…', pri: 2, gain: 0.42, press: 0.6, vars: 2, b: ['ちっ', 'ぐぬ…'], v: [
    [S(.004, { v: 'i', burst: { a: .3, f: 3600, bw: 2600, d: .005 } }), S(.1), S(.015, { v: 'N', av: .3, ah: .12, f0: 1.02 }), S(.07, { av: .65, ah: .15, f0: .96 }), S(.04, { av: 0, ah: 0, f0: .86 })],
    [S(.012, { v: 'u', av: .1, burst: { a: .25, f: 1700, bw: 900, d: .01 } }), S(.08, { av: .9, ah: .1, f0: 1.2 }), S(.012, { v: 'N', av: .7 }), S(.15, { av: .6, ah: .08, f0: 1.05 }), S(.05, { av: 0, ah: 0 })]] },
  clear:     { t: 'うおおっ！ / わっはっは', pri: 4, gain: 0.72, press: 0.75, vars: 2, b: ['やったー！', 'わっはっは！'], v: [
    [S(.03, { v: 'u', av: .4, ah: .3, f0: 1.5 }), S(.1, { v: 'o', av: 1, ah: .25, f0: 1.8 }), S(.3, { av: 1, ah: .3, f0: 2.05 }), S(.08, { av: .6, ah: .2, f0: 1.9 }), S(.04, { av: 0, ah: 0 })],
    [S(.02, { v: 'u', av: .3, ah: .2, f0: 1.6 }), S(.05, { v: 'a', av: .9, ah: .25, f0: 1.75 }), S(.05, { av: 0, ah: .1, f0: 1.6 })].concat(laughSeg(3, 1.7, 0.08))] },
  sigh:      { t: 'はぁ…', pri: 2, gain: 0.38, creak: 0.5, vars: 2, b: 'はぁ…', v: [
    [S(.04, { v: 'a', ah: .5, av: .04, f0: 1.05 }), S(.14, { ah: .45, av: .28, f0: 1.08 }), S(.4, { ah: .32, av: .15, f0: .8 }), S(.12, { ah: .08, av: 0, f0: .72 }), S(.05, { ah: 0 })]] },
  hum:       { t: 'ふ〜ん♪（鼻歌）', pri: 1, gain: 0.42, breath: -0.1, b: '♪', v: ['ん'], notes: [[0, 0.32], [7, 0.32], [7, 0.16], [8, 0.16], [7, 0.32], [5, 0.16], [3, 0.16], [2, 0.32], [0, 0.5]], hum: 1.25 }
};
const nVariants = (L) => L.v.length * (L.vars || 1);

/* Plan from segments (wordless vocalizations). Every variant gets its own small differences in timing, pitch and mouth. */
function segPlan(L, segs, P, rnd) {
  const sc = P.vt * (1 + (rnd() - 0.5) * 0.06);
  const tsc = (1 + (rnd() - 0.5) * 0.24) / ((L.rate || 1) * (P.rate || 1));
  const fsc = 1 + (rnd() - 0.5) * 0.12;
  // vocal effort: a shouting mouth opens wider (F1 rises) and the voice gets brighter
  const eff = clamp(L.press || 0, 0, 1), e1 = 1 + 0.22 * eff, e2 = 1 + 0.06 * eff;
  const vf = (v) => { const f = VOW[v] || VOW.x; const m = v === 'N' || v === 'm' || v === 'n' ? 1 : 0;
    return { f: [f[0] * sc * (m ? 1 : e1), f[1] * sc * (m ? 1 : e2), f[2] * sc, f[3] * sc], b: [f[4], f[5], f[6], f[7]] }; };
  let v = segs[0].v || 'x';
  const F = vf(v);
  const keys = [{ t: 0, f: F.f, b: F.b, av: 0, ah: 0, af: 0, ff: 3000, bf: 1500, nas: v === 'N' || v === 'm' ? 1 : 0 }], bursts = [], f0k = [];
  let cur = keys[0], t = 0.008, lastF0 = (segs[0].f0 != null ? segs[0].f0 : 1) * fsc;
  f0k.push([0, lastF0]);
  for (const sg of segs) {
    const d = sg.d * tsc;
    if (sg.burst) bursts.push({ t, dur: sg.burst.d || 0.01, amp: sg.burst.a || 0.5, ff: (sg.burst.f || 2000) * sc, bf: sg.burst.bw || 1500 });
    if (sg.v) v = sg.v;
    const V = vf(v);
    const k = { t: t + d, f: V.f, b: V.b, av: sg.av != null ? sg.av : cur.av, ah: sg.ah != null ? sg.ah : cur.ah, af: sg.af != null ? sg.af : cur.af,
      ff: sg.ff ? sg.ff * sc : cur.ff, bf: sg.bf || cur.bf, nas: sg.nas != null ? sg.nas : (v === 'N' || v === 'm' || v === 'n' ? 1 : 0) };
    keys.push(k); cur = k;
    if (sg.f0 != null) { lastF0 = sg.f0 * fsc; f0k.push([t + d, lastF0]); }
    t += d;
  }
  keys.push(Object.assign({}, cur, { t: t + 0.03, av: 0, ah: 0, af: 0 }));
  f0k.push([t + 0.06, lastF0]);
  return { keys, bursts, wob: [], dur: t + 0.06, f0k };
}

/* Build a time plan: keyframes of formant / source parameters, plus plosive bursts. */
function buildPlan(line, text, P) {
  const units = parseKana(text);
  const rate = (line.rate || 1) * (P.rate || 1);
  const D = 0.112 / rate;
  const keys = [], bursts = [], wob = [];
  const sc = P.vt;
  const vf = (v) => { const f = VOW[v] || VOW.a; return { f: [f[0] * sc, f[1] * sc, f[2] * sc, f[3] * sc], b: [f[4], f[5], f[6], f[7]] }; };
  const first = units.find(u => u.v); const fv = vf(first ? first.v : 'a');
  keys.push({ t: 0, f: fv.f.slice(), b: fv.b.slice(), av: 0, ah: 0, af: 0, ff: 3000, bf: 1500, nas: 0 });
  const K = (t, o) => { const p = keys[keys.length - 1]; const k = Object.assign({}, p, o); k.t = Math.max(p.t, t); if (o.f) k.f = o.f.slice(); if (o.b) k.b = o.b.slice(); keys.push(k); return k; };
  const breath = clamp((P.breath || 0) + (line.breath || 0), 0, 1);
  const vowelAH = 0.05 + 0.4 * breath, vowelAV = 1 - 0.55 * breath;
  let t = 0.015, voiced = false, gemExtra = 0, hardNext = false;
  for (let i = 0; i < units.length; i++) {
    const u = units[i], nx = units[i + 1];
    if (u.pause) { K(t, {}); K(t + 0.02, { av: 0, ah: 0, af: 0 }); t += u.pause; voiced = false; continue; }
    if (u.trail) continue;
    if (u.gem) {
      const nextCons = nx && nx.v && nx.c && nx.c !== 'N' && nx.c !== 'y' && nx.c !== 'w' && nx.c !== 'r';
      K(t, {}); K(t + 0.009, { av: 0, ah: 0, af: 0 });          // glottal stop / closure
      if (nextCons) { gemExtra = D * 0.75; t += 0.009; } else { t += 0.06; hardNext = true; }
      voiced = false; continue;
    }
    const V = vf(u.v), c = u.c;
    let tc = t;
    const front = u.v === 'i' || u.v === 'e';
    switch (c) {
      case '': case 'N':
        if (!voiced) { K(t, { f: V.f, b: V.b, av: 0, ah: 0, af: 0, nas: c === 'N' ? 1 : 0 }); }
        tc = t; break;
      case 'h': case 'hy': case 'f': {
        const fr = c === 'f' ? { af: 0.22, ff: 1500 * sc, bf: 2600 } : c === 'hy' ? { af: 0.2, ff: 3300 * sc, bf: 1300 } : { af: 0, ff: 3000, bf: 1500 };
        K(t, { f: V.f, b: V.b, av: voiced ? 0.25 : 0, ah: 0, nas: 0 });
        K(t + 0.014, Object.assign({ av: 0, ah: c === 'f' ? 0.25 : 0.62 }, fr));
        K(t + 0.06 * Math.min(1.2, 1 / rate * 1.1), { ah: c === 'f' ? 0.22 : 0.55 });
        tc = keys[keys.length - 1].t; break;
      }
      case 'k': case 'ky': case 'g': case 'gy': case 't': case 'd': case 'p': case 'py': case 'b': case 'by': {
        const vd = c === 'g' || c === 'gy' || c === 'd' || c === 'b' || c === 'by';
        const place = c[0];
        const loc = place === 't' || place === 'd' ? [400 * sc, 1700 * sc, 2700 * sc] : place === 'k' || place === 'g' ? (front ? [350 * sc, 2300 * sc, 2800 * sc] : [380 * sc, 1700 * sc, 2150 * sc]) : [380 * sc, 900 * sc, 2200 * sc];
        const clo = (vd ? 0.032 : 0.048) + gemExtra; gemExtra = 0;
        K(t, {}); K(t + 0.012, { av: vd ? 0.1 : 0, ah: 0, af: 0, nas: 0, f: [vd ? 200 : loc[0], loc[1], loc[2], V.f[3]] });
        K(t + clo, {});
        const bf = place === 't' || place === 'd' ? [4200 * sc, 1800] : place === 'k' || place === 'g' ? [(front ? 3000 : 1700) * sc, 900] : [900, 1200];
        bursts.push({ t: t + clo, dur: place === 'k' || place === 'g' ? 0.014 : place === 't' || place === 'd' ? 0.009 : 0.006, amp: vd ? 0.3 : 0.6, ff: bf[0], bf: bf[1] });
        if (!vd) { const asp = place === 'k' ? 0.032 : 0.02; K(t + clo + 0.003, { ah: 0.3, av: 0 }); K(t + clo + asp, { ah: 0.24 }); tc = t + clo + asp; }
        else { K(t + clo + 0.003, { av: 0.55, f: [300 * sc, loc[1], loc[2], V.f[3]] }); tc = t + clo + 0.006; }
        if (c.length === 2 && c[1] === 'y') { K(tc + 0.002, { f: vf('i').f }); tc += 0.03; }
        break;
      }
      case 's': case 'sh': case 'z': case 'j': {
        const vd = c === 'z' || c === 'j';
        const dur = (c === 's' ? 0.085 : c === 'sh' ? 0.092 : 0.062) / Math.sqrt(rate) + gemExtra; gemExtra = 0;
        const ff = c === 's' || c === 'z' ? 5200 * sc : 2900 * sc, bf = c === 's' || c === 'z' ? 2200 : 1600;
        K(t, {}); K(t + 0.012, { av: vd ? 0.32 : 0, ah: 0, af: vd ? 0.3 : 0.55, ff, bf, nas: 0, f: c === 'sh' || c === 'j' ? vf('i').f : V.f });
        K(t + dur - 0.012, {}); K(t + dur, { af: u.devoice ? 0.5 : 0.04 });
        tc = t + dur; break;
      }
      case 'ch': case 'ts': {
        const clo = 0.036 + gemExtra; gemExtra = 0;
        const ff = c === 'ts' ? 5200 * sc : 2900 * sc, bf = c === 'ts' ? 2200 : 1600;
        K(t, {}); K(t + 0.012, { av: 0, ah: 0, af: 0, nas: 0 }); K(t + clo, {});
        bursts.push({ t: t + clo, dur: 0.008, amp: 0.5, ff, bf });
        K(t + clo + 0.004, { af: 0.55, ff, bf, f: c === 'ch' ? vf('i').f : V.f }); K(t + clo + 0.05, {}); K(t + clo + 0.058, { af: u.devoice ? 0.5 : 0.04 });
        tc = t + clo + 0.058; break;
      }
      case 'n': case 'm': case 'ny': case 'my': {
        const F = vf(c[0] === 'm' ? 'm' : 'n');
        if (!voiced) K(t, { f: F.f, b: F.b, av: 0, ah: 0, af: 0, nas: 1 });
        K(t + 0.015, { f: F.f, b: F.b, av: 0.55, ah: 0, af: 0, nas: 1 }); K(t + 0.055, {});
        tc = t + 0.055; if (c.length === 2) { K(tc + 0.002, { f: vf('i').f, nas: 0 }); tc += 0.028; }
        break;
      }
      case 'y': case 'w': {
        const G = c === 'y' ? vf('i') : { f: [330 * sc, 780 * sc, 2300 * sc, 3400 * sc], b: VOW.u.slice(4) };
        if (!voiced) { K(t, { f: G.f, b: G.b, av: 0, ah: 0, af: 0, nas: 0 }); K(t + 0.02, { av: 0.75 }); }
        else K(t + 0.015, { f: G.f, b: G.b, nas: 0 });
        tc = t + 0.045; K(tc, {}); break;
      }
      case 'r': {
        if (!voiced) K(t, { av: 0, ah: 0, af: 0 });
        K(t + 0.006, { av: 0.42, f: [330 * sc, 1500 * sc, 1950 * sc, V.f[3]], nas: 0 }); K(t + 0.026, {});
        tc = t + 0.026; break;
      }
    }
    // vowel nucleus
    const onset = (!voiced && (c === '' || c === 'N')) ? (hardNext ? 0.01 : 0.028) : 0.034;
    hardNext = false;
    const vd = Math.max(0.05, D * u.len - (tc - t) + (u.len > 1 ? 0 : 0.01));
    const dv = !!u.devoice;
    K(tc + Math.min(onset, vd * 0.5), { f: V.f, b: V.b, av: dv ? 0 : (c === 'N' ? 0.6 : vowelAV), ah: dv ? 0.32 : vowelAH, af: dv ? keys[keys.length - 1].af : 0, nas: c === 'N' ? 1 : 0 });
    K(tc + vd, {});
    if (u.wob) wob.push([tc, tc + vd]);
    t = tc + vd; voiced = !dv;
  }
  const trail = units.some(u => u.trail);
  K(t, {}); K(t + (trail ? 0.22 : 0.05), { av: 0, ah: 0, af: 0 });
  return { keys, bursts, wob, dur: t + (trail ? 0.26 : 0.08) };
}

/* Render one line to a Float32Array (mono). line: LINES entry or {v:[...]...}; text: variant text. */
function renderLine(sr, line, text, prof, seed) {
  const P = Object.assign({}, PROFILES.ojisan, typeof prof === 'string' ? PROFILES[prof] : prof);
  let plan;
  if (line.sustain) plan = sustainPlan(line, P);
  else if (Array.isArray(text)) plan = segPlan(line, text, P, prng((seed || 1) * 7919 + 13));
  else plan = buildPlan(line, text, P);
  if (line.notes) { let tot = 0.03; for (const n of line.notes) tot += n[1]; plan = sustainPlan({ vowel: 'N', sustain: tot, attack: 0.04, release: 0.08 }, P); }
  return synth(sr, plan, line, P, seed);
}
function sustainPlan(line, P) {
  const f = VOW[line.vowel || 'a'], sc = P.vt, T = line.sustain, A = line.attack || 0.3, R = line.release || 0.5;
  const ff = [f[0] * sc, f[1] * sc, f[2] * sc, f[3] * sc], bb = [f[4], f[5], f[6], f[7]];
  const nas = line.vowel === 'N' ? 1 : 0, av = nas ? 0.7 : 1, ah = 0.05 + 0.4 * clamp((P.breath || 0) + (line.breath || 0), 0, 1);
  const keys = [{ t: 0, f: ff, b: bb, av: 0, ah: 0, af: 0, ff: 3000, bf: 1500, nas }, { t: A, f: ff, b: bb, av, ah, af: 0, ff: 3000, bf: 1500, nas },
    { t: T - R, f: ff, b: bb, av, ah, af: 0, ff: 3000, bf: 1500, nas }, { t: T, f: ff, b: bb, av: 0, ah: 0, af: 0, ff: 3000, bf: 1500, nas }];
  return { keys, bursts: [], wob: [], dur: T + 0.02 };
}

const CASC_GAIN = 0.11, FRIC_GAIN = 0.3, BURST_GAIN = 0.75, ASP_GAIN = 0.5, AIR_GAIN = 0.04;
/* Source: a Rosenberg glottal flow pulse (its derivative excites the tract), with the irregularities real voices have —
   period jitter, slow pitch flutter, pulse-to-pulse amplitude shimmer, breath noise that pulses with the vocal folds,
   creak at the end of tired sounds — then a cascade of formant resonators whose centres drift slightly over time. */
function synth(sr, plan, L, P, seed) {
  const N = Math.max(1, Math.ceil(plan.dur * sr));
  const out = new Float32Array(N);
  const rnd = prng(seed || 7);
  const nz = () => rnd() * 2 - 1;
  const keys = plan.keys, bursts = plan.bursts;
  const press = clamp(L.press || 0, 0, 1), breath = clamp((P.breath || 0) + (L.breath || 0), 0, 1), rough = clamp((P.rough || 0) + (L.rough || 0), 0, 1);
  const OQ = clamp(0.62 - 0.2 * press + 0.16 * breath, 0.38, 0.85);
  const SQ = 2.0 + 1.2 * press, Tp = OQ * SQ / (1 + SQ), Tn = OQ - Tp;
  const tiltK = clamp(0.12 + 0.5 * breath - 0.12 * press, 0.02, 0.85);
  const jit = (P.jitter || 0.01) + 0.006 * rough, shim = 0.035 + 0.08 * rough;
  const vib = L.vib || [0, 5];
  const fl = [[1.7 + rnd(), rnd() * TAU], [3.9 + rnd(), rnd() * TAU], [6.3 + rnd(), rnd() * TAU]];
  const dr = [0, 1, 2, 3].map(i => [1.6 + i * 0.9 + rnd(), rnd() * TAU, 0.008 + 0.006 * rnd()]);
  const dur = plan.dur, f0k = plan.f0k;
  const f0At = (t) => {
    let f;
    if (L.notes) {
      let acc = 0.03, m = L.notes[0][0];
      for (let i = 0; i < L.notes.length; i++) { const n = L.notes[i]; if (t < acc + n[1]) { const prev = i ? L.notes[i - 1][0] : n[0]; const k = clamp((t - acc) / 0.045, 0, 1); m = lerp(prev, n[0], 0.5 - 0.5 * Math.cos(Math.PI * k)); break; } acc += n[1]; m = n[0]; }
      f = (L.base || P.f0 * (L.hum || 1)) * Math.pow(2, m / 12);
    } else if (L.pitchHz) f = L.pitchHz;
    else if (f0k) {
      let i = 0; while (i < f0k.length - 2 && f0k[i + 1][0] <= t) i++;
      const a = f0k[i], b = f0k[Math.min(i + 1, f0k.length - 1)], u = b[0] > a[0] ? clamp((t - a[0]) / (b[0] - a[0]), 0, 1) : 1;
      f = P.f0 * lerp(a[1], b[1], 0.5 - 0.5 * Math.cos(Math.PI * u));
    } else f = P.f0 * curve(L.pitch || [[0, 1], [1, 0.9]], t / dur);
    for (const w of plan.wob) if (t > w[0] && t < w[1]) f *= 1 + 0.03 * Math.sin((t - w[0]) * TAU * 6);
    return f;
  };
  let k = 0; const kN = keys.length;
  const F = [0, 0, 0, 0], B = [0, 0, 0, 0];
  const ra = new Float64Array(6), rb = new Float64Array(6), rc = new Float64Array(6), y1 = new Float64Array(6), y2 = new Float64Array(6);
  let av = 0, ah = 0, af = 0, ff = 3000, bf = 1500, nas = 0;
  let npA = 0, npB = 0, npC = 0, np1 = 0, np2 = 0, nzA = 1, nzB = 0, nzC = 0, nz1 = 0, nz2 = 0;
  let frPrev = 0, frA = 0, frB = 0, frC = 0, fr1 = 0, fr2 = 0, brA = 0, brB = 0, brC = 0, br1 = 0, br2 = 0;
  const T = 1 / sr;
  const coef = (f, bw, i) => { const C = -Math.exp(-TAU * bw * T); const Bc = 2 * Math.exp(-Math.PI * bw * T) * Math.cos(TAU * Math.min(f, sr * 0.45) * T); ra[i] = 1 - Bc - C; rb[i] = Bc; rc[i] = C; };
  coef(4500 * P.vt, 400, 4); coef(5500 * P.vt, 550, 5);
  let phase = 0, perF = P.f0, perAmp = 1, perIdx = 0, tilt = 0, uPrev = 0, dc1 = 0, dcy = 0;
  const hpK = Math.exp(-TAU * 300 * T), lpK = Math.exp(-TAU * 2800 * T), airK = Math.exp(-TAU * 2500 * T);
  let hpX = 0, hpY = 0, lpY = 0, airX = 0, airY = 0, tiltPrev = 0;
  const bright = press;   // pressed (strained/shouted) phonation has a flatter, brighter spectrum
  let bi = 0, burstAmp = 0, burstEnd = -1, burstDur = 0.01;
  const vibPh = rnd() * TAU;
  for (let n = 0; n < N; n++) {
    const t = n * T;
    if ((n & 15) === 0) {
      while (k < kN - 2 && keys[k + 1].t <= t) k++;
      const a = keys[k], b = keys[Math.min(k + 1, kN - 1)];
      const u = b.t > a.t ? clamp((t - a.t) / (b.t - a.t), 0, 1) : 1;
      for (let j = 0; j < 4; j++) { F[j] = lerp(a.f[j], b.f[j], u) * (1 + dr[j][2] * Math.sin(TAU * dr[j][0] * t + dr[j][1])); B[j] = lerp(a.b[j], b.b[j], u); coef(F[j], B[j], j); }
      const ampC = L.amp ? curve(L.amp, t / dur) : 1;
      av = lerp(a.av, b.av, u) * ampC; ah = lerp(a.ah, b.ah, u) * ampC; af = lerp(a.af, b.af, u) * ampC;
      ff = lerp(a.ff, b.ff, u); bf = lerp(a.bf, b.bf, u); nas = lerp(a.nas, b.nas, u);
      { const fp = 270 * P.vt, bwp = 100, fz = fp + nas * 480, bwz = 100 + nas * 60;
        const C = -Math.exp(-TAU * bwp * T), Bc = 2 * Math.exp(-Math.PI * bwp * T) * Math.cos(TAU * fp * T); npA = 1 - Bc - C; npB = Bc; npC = C;
        const Cz = -Math.exp(-TAU * bwz * T), Bz = 2 * Math.exp(-Math.PI * bwz * T) * Math.cos(TAU * fz * T), Az = 1 - Bz - Cz; nzA = 1 / Az; nzB = -Bz / Az; nzC = -Cz / Az; }
      { const C = -Math.exp(-TAU * bf * T), Bc = 2 * Math.exp(-Math.PI * bf * T) * Math.cos(TAU * Math.min(ff, sr * 0.45) * T); frA = 1 - Bc - C; frB = Bc; frC = C; }
    }
    if (bi < bursts.length && t >= bursts[bi].t) {
      const bu = bursts[bi]; burstAmp = bu.amp; burstEnd = t + bu.dur; burstDur = bu.dur;
      const C = -Math.exp(-TAU * bu.bf * T), Bc = 2 * Math.exp(-Math.PI * bu.bf * T) * Math.cos(TAU * Math.min(bu.ff, sr * 0.45) * T); brA = 1 - Bc - C; brB = Bc; brC = C;
      bi++;
    }
    // glottal pulse
    phase += perF * T;
    if (phase >= 1) {
      phase -= 1; perIdx++;
      const creakK = L.creak ? clamp((t / dur - 0.55) / 0.45, 0, 1) * L.creak : 0;
      const flut = 0.012 * (Math.sin(TAU * fl[0][0] * t + fl[0][1]) * 0.5 + Math.sin(TAU * fl[1][0] * t + fl[1][1]) * 0.3 + Math.sin(TAU * fl[2][0] * t + fl[2][1]) * 0.2);
      perF = f0At(t) * (1 + vib[0] * Math.sin(vibPh + t * TAU * vib[1]) + flut) * (1 + nz() * jit * (1 + 6 * creakK)) * (1 - 0.35 * creakK);
      perAmp = (1 + nz() * shim) * ((perIdx & 1) ? 1 - 0.3 * rough - 0.45 * creakK : 1);
    }
    let ug;
    if (phase < Tp) ug = 0.5 - 0.5 * Math.cos(Math.PI * phase / Tp);
    else if (phase < OQ) ug = Math.cos(0.5 * Math.PI * (phase - Tp) / Tn);
    else ug = 0;
    const du = (ug - uPrev) * (sr / perF) * 0.18; uPrev = ug;
    tilt = tilt * tiltK + du * (1 - tiltK);
    const src = tilt * (1 - 0.3 * bright) + (tilt - tiltPrev) * bright * 12; tiltPrev = tilt;
    // breath noise: band-limited (300 Hz – 2.8 kHz, like turbulence at the glottis), pulsing with the vocal folds when voiced,
    // and much weaker through a closed mouth (nasal hum)
    const w = nz(); hpY = hpK * (hpY + w - hpX); hpX = w; lpY = lpY * lpK + hpY * (1 - lpK);
    const asp = lpY * 1.8 * ah * (av > 0.05 ? 0.3 + 1.0 * ug : 1) * (1 - 0.85 * nas);
    let s = src * av * perAmp + asp * ASP_GAIN;
    { const zz = nzA * s + nzB * nz1 + nzC * nz2; nz2 = nz1; nz1 = s; s = zz; const pp = npA * s + npB * np1 + npC * np2; np2 = np1; np1 = pp; s = pp; }
    for (let j = 0; j < 6; j++) { const y = ra[j] * s + rb[j] * y1[j] + rc[j] * y2[j]; y2[j] = y1[j]; y1[j] = y; s = y; }
    // "air": breath noise above the formants (real breath is broadband)
    airY = airK * (airY + asp - airX); airX = asp;
    const fsrc = nz() * af;
    const fo0 = frA * fsrc + frB * fr1 + frC * fr2; fr2 = fr1; fr1 = fo0; const fo = fo0 - 0.82 * frPrev; frPrev = fo0;
    let bo = 0;
    if (t < burstEnd) { const be = burstAmp * (0.35 + 0.65 * (burstEnd - t) / burstDur); const bin = nz() * be; bo = brA * bin + brB * br1 + brC * br2; br2 = br1; br1 = bo; }
    else if (br1 !== 0 || br2 !== 0) { bo = brB * br1 + brC * br2; br2 = br1; br1 = bo; if (Math.abs(bo) < 1e-7) { br1 = br2 = 0; } }
    let o = s * CASC_GAIN + airY * AIR_GAIN + fo * FRIC_GAIN + bo * BURST_GAIN;
    const y = o - dc1 + 0.995 * dcy; dc1 = o; dcy = y; o = y;
    out[n] = o;
  }
  // fades, then level by loudness (the loudest 100 ms), not by peak: breathy sounds have spiky noise peaks and would
  // otherwise come out far quieter than they sound. A soft knee only touches the rare peaks above 0.7.
  const fi = Math.min(N, Math.floor(0.004 * sr)), fo2 = Math.min(N, Math.floor(0.012 * sr));
  for (let i = 0; i < fi; i++) out[i] *= i / fi;
  for (let i = 0; i < fo2; i++) out[N - 1 - i] *= i / fo2;
  const w = Math.min(N, Math.floor(0.1 * sr)); let acc = 0, mx = 0;
  for (let i = 0; i < N; i++) { acc += out[i] * out[i]; if (i >= w) acc -= out[i - w] * out[i - w]; if (i >= w - 1 && acc > mx) mx = acc; }
  const rms = Math.sqrt(Math.max(mx, 0) / w);
  const g = rms > 1e-9 ? (L.gain == null ? 0.7 : L.gain) * 0.447 / rms : 0;
  for (let i = 0; i < N; i++) { const x = out[i] * g, a = Math.abs(x); out[i] = a <= 0.7 ? x : Math.sign(x) * (0.7 + 0.3 * Math.tanh((a - 0.7) / 0.3)); }
  return out;
}

/* =====================================================================================
   ENGINE (Web Audio)
   ===================================================================================== */
const NOTE = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
function nm(s) { const m = /^([A-G][#b]?)(-?\d)$/.exec(s); return 12 * (+m[2] + 1) + NOTE[m[1]]; }
function mel(str) { // "D4:4 A4:4 | ..." → [{step, m, len}] (16th steps), r = rest
  const ev = []; let step = 0;
  for (const bar of str.split('|')) { let s = 0; for (const tok of bar.trim().split(/\s+/)) { if (!tok) continue; const [n, l] = tok.split(':'); const len = +l; if (n !== 'r') ev.push({ step: step + s, m: nm(n), len }); s += len; } step += 16; }
  return ev;
}
const CH = {
  Dm: { root: 38, pad: [50, 57, 62, 65], choir: [50, 57, 62, 65], ost: [50, 57, 62] },
  Bb: { root: 34, pad: [46, 53, 58, 62], choir: [50, 53, 58, 62], ost: [46, 53, 58] },
  F:  { root: 41, pad: [48, 53, 57, 60], choir: [48, 53, 57, 60], ost: [41, 48, 53] },
  C:  { root: 36, pad: [48, 52, 55, 60], choir: [48, 55, 60, 64], ost: [48, 55, 60] },
  Gm: { root: 43, pad: [50, 55, 58, 62], choir: [50, 55, 58, 62], ost: [43, 50, 55] },
  A:  { root: 33, pad: [49, 52, 57, 61], choir: [49, 57, 61, 64], ost: [45, 52, 57] },
  D:  { root: 38, pad: [50, 54, 57, 62], choir: [50, 57, 62, 66], ost: [50, 57, 62] },
  G:  { root: 43, pad: [50, 55, 59, 62], choir: [50, 55, 59, 62], ost: [43, 50, 55] }
};
// The theme (original). 8 bars over Dm Dm Bb Bb F C Gm A.
const THEME = mel('D4:4 A4:4 A4:2 Bb4:2 A4:4 | G4:2 F4:2 E4:4 D4:8 | D4:4 F4:4 Bb4:4 A4:2 G4:2 | F4:8 D4:8 | C5:4 A4:4 F4:4 A4:2 C5:2 | D5:4 C5:4 G4:8 | Bb4:4 A4:2 G4:2 D5:4 Bb4:4 | E4:4 A4:4 C#5:4 E5:4');
const PROG = ['Dm', 'Dm', 'Bb', 'Bb', 'F', 'C', 'Gm', 'A'];
const WIG_PROG = ['D', 'C', 'G', 'A'];
const WIG_MEL = mel('A4:2 D5:2 F#5:4 A5:4 F#5:2 A5:2 | G5:6 E5:2 C5:4 E5:4 | D5:4 B4:2 D5:2 G5:4 B4:4 | A4:4 C#5:4 E5:4 A5:4');
const CLEAR_MEL = mel('A4:2 A4:2 D5:4 F#5:4 E5:2 D5:2 | E5:8 C#5:4 A4:4 | D5:16 | r:16');
const BREAK_PROG = ['Dm', 'Bb', 'F', 'C'];
const BREAK_MEL = mel('D5:4 A5:4 A5:2 Bb5:2 A5:4 | G5:2 F5:2 E5:4 D5:8 | r:16 | r:16');
const CHOIR_BASES = [43, 47, 51, 55, 59, 63, 67];   // ensemble samples every 4 semitones; notes shift ≤ 2 semitones

function createEngine(ctx, opts) {
  opts = opts || {};
  const SKIP = opts.skip || {};
  const E = { ctx, offline: !!opts.offline, quality: opts.quality || 'standard', stats: { sfx: {}, voice: {}, cues: [], notes: 0, choirFallback: 0 } };
  const sr = ctx.sampleRate;
  const light = () => E.quality === 'light';
  const now = () => (E.offline ? E.clock : ctx.currentTime);
  E.clock = 0;
  const lineCache = new Map(), choirCache = new Map(), chantCache = new Map();

  /* ---------- buffers ---------- */
  function noiseBuf(kind, sec) {
    const n = Math.floor(sr * sec), b = ctx.createBuffer(1, n, sr), d = b.getChannelData(0), r = prng(kind.length * 977 + 3);
    let b0 = 0, b1 = 0, b2 = 0, last = 0;
    for (let i = 0; i < n; i++) {
      const w = r() * 2 - 1;
      if (kind === 'white') d[i] = w;
      else if (kind === 'pink') { b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2; }
      else { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.2; }
    }
    // crossfade the ends so it loops cleanly
    const x = Math.floor(sr * 0.05); for (let i = 0; i < x; i++) { const k = i / x; d[n - x + i] = d[n - x + i] * (1 - k) + d[i] * k; }
    return b;
  }
  const NB = { white: noiseBuf('white', 2), pink: noiseBuf('pink', 3), brown: noiseBuf('brown', 3) };
  function makeIR(sec, decay, dark, seed) {
    const n = Math.floor(sr * sec), b = ctx.createBuffer(2, n, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch), r = prng(seed + ch * 101); let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr, env = Math.pow(1 - i / n, decay) * Math.min(1, t / 0.008);
        const a = 1 - (0.1 + dark * Math.min(1, t / (sec * 0.6)));
        lp += (r() * 2 - 1 - lp) * a; d[i] = lp * env;
      }
      for (const [dt, g] of [[0.011, 0.5], [0.019, 0.38], [0.029, 0.3], [0.043, 0.24], [0.059, 0.18], [0.077, 0.14]]) { const i = Math.floor((dt + ch * 0.0027) * sr); if (i < n) d[i] += g * (((i + ch) & 1) ? 1 : -1); }
    }
    return b;
  }

  /* ---------- buses ---------- */
  const master = ctx.createGain();
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -4; limiter.knee.value = 4; limiter.ratio.value = 14; limiter.attack.value = 0.002; limiter.release.value = 0.18;
  // safety soft-clip after the limiter: linear below 0.85, smoothly saturating to 1.0 above (never hard-clips)
  const clipPre = ctx.createGain(); clipPre.gain.value = 1 / 1.5; const clipper = ctx.createWaveShaper();
  { const n = 4096, c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = (i / (n - 1) * 2 - 1) * 1.5, a = Math.abs(x); c[i] = Math.sign(x) * (a < 0.85 ? a : 0.85 + 0.15 * Math.tanh((a - 0.85) / 0.15)); } clipper.curve = c; clipper.oversample = '2x'; }
  master.gain.value = 0.94; master.connect(limiter); limiter.connect(clipPre); clipPre.connect(clipper); clipper.connect(ctx.destination);
  const musicIn = ctx.createGain();          // all music (dry + reverb return)
  const musicVol = ctx.createGain(); musicVol.gain.value = 0.55;
  const musicFilter = ctx.createBiquadFilter(); musicFilter.type = 'lowpass'; musicFilter.frequency.value = 20000; musicFilter.Q.value = 0.5;
  const musicDuck = ctx.createGain();   // voice ducking
  const musicPause = ctx.createGain();  // pause dip
  const musicComp = ctx.createDynamicsCompressor(); musicComp.threshold.value = -16; musicComp.ratio.value = 3; musicComp.attack.value = 0.01; musicComp.release.value = 0.25; musicComp.knee.value = 8;
  // drunk wobble: a modulated delay crossfaded in when the player is drunk
  const wobDry = ctx.createGain(), wobWet = ctx.createGain(); wobWet.gain.value = 0;
  const wobDelay = ctx.createDelay(0.05); wobDelay.delayTime.value = 0.012;
  const wobLfo = ctx.createOscillator(); wobLfo.frequency.value = 0.9; const wobDepth = ctx.createGain(); wobDepth.gain.value = 0.006;
  wobLfo.connect(wobDepth); wobDepth.connect(wobDelay.delayTime); wobLfo.start(0);
  musicIn.connect(wobDry); musicIn.connect(wobDelay); wobDelay.connect(wobWet);
  wobDry.connect(musicComp); wobWet.connect(musicComp);
  musicComp.connect(musicFilter); musicFilter.connect(musicPause); musicPause.connect(musicDuck); musicDuck.connect(musicVol); musicVol.connect(master);
  const musicRev = ctx.createConvolver(); if (!SKIP.reverb) musicRev.buffer = makeIR(light() ? 1.6 : 2.9, 3.2, 0.75, 11);
  const musicRevIn = ctx.createGain(); musicRevIn.gain.value = 1; if (!SKIP.reverb) musicRevIn.connect(musicRev);
  const musicRevOut = ctx.createGain(); musicRevOut.gain.value = 0.55; musicRev.connect(musicRevOut); musicRevOut.connect(musicIn);
  const sfxVol = ctx.createGain(); sfxVol.gain.value = 0.75; sfxVol.connect(master);
  const sfxIn = ctx.createGain(); sfxIn.connect(sfxVol);
  const sfxRev = ctx.createConvolver(); sfxRev.buffer = makeIR(1.1, 4, 0.6, 23);
  const sfxRevIn = ctx.createGain(); sfxRevIn.connect(sfxRev); const sfxRevOut = ctx.createGain(); sfxRevOut.gain.value = 0.5; sfxRev.connect(sfxRevOut); sfxRevOut.connect(sfxVol);
  const ambIn = ctx.createGain(); ambIn.connect(sfxVol);
  const voiceVol = ctx.createGain(); voiceVol.gain.value = 0.85; voiceVol.connect(master);
  const voiceComp = ctx.createDynamicsCompressor(); voiceComp.threshold.value = -14; voiceComp.ratio.value = 3; voiceComp.attack.value = 0.003; voiceComp.release.value = 0.12;
  const voiceMakeup = ctx.createGain(); voiceMakeup.gain.value = 1.55; voiceComp.connect(voiceMakeup); voiceMakeup.connect(voiceVol);
  const voiceRevSend = ctx.createGain(); voiceRevSend.gain.value = 0.18; voiceRevSend.connect(sfxRevIn);
  E.nodes = { master, musicVol, sfxVol, voiceVol, musicFilter, musicDuck };

  E.setVolumes = function (v) {
    const t = now();
    if (v.music != null) musicVol.gain.setTargetAtTime(v.music * 0.9, t, 0.05);
    if (v.se != null) sfxVol.gain.setTargetAtTime(v.se, t, 0.05);
    if (v.voice != null) voiceVol.gain.setTargetAtTime(v.voice, t, 0.05);
  };
  E.setMute = function (m) { master.gain.setTargetAtTime(m ? 0 : 0.94, now(), 0.03); E.muted = !!m; };

  /* ---------- small builders ---------- */
  const panCache = new Map(); let destId = 0;
  const out = (node, dest, pan) => {
    if (pan && ctx.createStereoPanner) {
      const pv = Math.round(clamp(pan, -1, 1) * 10) / 10;
      if (pv !== 0) {
        if (!dest.__pid) dest.__pid = ++destId;
        const key = dest.__pid + ':' + pv; let p = panCache.get(key);
        if (!p) { p = ctx.createStereoPanner(); p.pan.value = pv; p.connect(dest); panCache.set(key, p); }
        node.connect(p); return p;
      }
    }
    node.connect(dest); return node;
  };
  const freeOnEnd = (src, ...nodes) => { src.onended = () => { try { src.disconnect(); } catch (e) {} for (const n of nodes) { try { n.disconnect(); } catch (e) {} } }; };
  function envGain(t, a, peak, d, dest) { // attack to peak, exponential decay over d
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.setTargetAtTime(0.0001, t + a, d / 4); if (dest) g.connect(dest); return g;
  }
  function noise(t, dur, o) { // o: {type, freq, q, gain, dest, buf, attack, sweep}
    const src = ctx.createBufferSource(); src.buffer = NB[o.buf || 'white']; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = o.type || 'bandpass'; f.frequency.setValueAtTime(o.freq || 1000, t); f.Q.value = o.q == null ? 1 : o.q;
    if (o.sweep) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.sweep), t + dur);
    const g = envGain(t, o.attack || 0.002, o.gain || 0.3, dur);
    src.connect(f); f.connect(g); out(g, o.dest || curDest || sfxIn, o.pan);
    if (o.rev) { const s = ctx.createGain(); s.gain.value = o.rev; g.connect(s); s.connect(o.revDest || sfxRevIn); }
    src.start(t, rndOff()); src.stop(t + (o.attack || 0.002) + dur * 1.3 + 0.03); freeOnEnd(src, f, g);
    return g;
  }
  const rr = prng(99); const rndOff = () => rr() * 1.5; const rnd = () => rr();
  let curDest = null;   // set by E.sfx for per-call gain/pan
  function tone(t, freq, dur, o) { // o: {type, gain, slide, dest, attack, pan, rev}
    const osc = ctx.createOscillator(); osc.type = o.type || 'sine'; osc.frequency.setValueAtTime(freq, t);
    if (o.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(10, o.slide), t + (o.slideT || dur));
    if (o.detune) osc.detune.value = o.detune;
    const g = envGain(t, o.attack || 0.004, o.gain || 0.3, dur);
    osc.connect(g); out(g, o.dest || curDest || sfxIn, o.pan);
    if (o.rev) { const s = ctx.createGain(); s.gain.value = o.rev; g.connect(s); s.connect(o.revDest || sfxRevIn); }
    osc.start(t); osc.stop(t + (o.attack || 0.004) + dur * 1.3 + 0.03); freeOnEnd(osc, g);
    return g;
  }

  /* ---------- percussion: rendered once in JS, then played as buffers (one node per hit) ---------- */
  function biquad(type, f, q) { // RBJ cookbook → processor
    const w = TAU * f / sr, cs = Math.cos(w), al = Math.sin(w) / (2 * q); let b0, b1, b2, a0, a1, a2;
    if (type === 'bp') { b0 = al; b1 = 0; b2 = -al; } else if (type === 'hp') { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = (1 + cs) / 2; } else { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = (1 - cs) / 2; }
    a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al;
    b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0; let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    return (x) => { const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x; y2 = y1; y1 = y; return y; };
  }
  const drumCache = new Map();
  function drum(kind, p) {
    const key = kind + ':' + (p == null ? '' : p); let b = drumCache.get(key); if (b) return b;
    const r = prng(hashStr(key)); const nz = () => r() * 2 - 1;
    let len, fn;
    if (kind === 'taiko') {
      const size = p, f0 = size > 0.8 ? 120 : size > 0.5 ? 190 : 300, f1 = size > 0.8 ? 46 : size > 0.5 ? 85 : 150;
      const tp = (0.32 * size + 0.05) / 3, td = (0.5 * size + 0.25) / 4, bp = biquad('bp', size > 0.8 ? 280 : 600, 1.1);
      len = 0.5 * size + 0.25 + 4 * td; let ph = 0, ph2 = 0;
      fn = (t) => { const f = f1 + (f0 - f1) * Math.exp(-t / tp); ph += f / sr; ph2 += f * 2.25 / sr;
        return Math.sin(TAU * ph) * Math.exp(-t / td) * 0.95 + Math.sin(TAU * ph2) * Math.exp(-t / 0.03) * 0.18 + bp(nz()) * Math.exp(-t / 0.018) * 0.9 * Math.min(1, t / 0.0015); };
    } else if (kind === 'ka') { const bp = biquad('bp', 2600, 5); len = 0.06; let ph = 0; fn = (t) => { ph += 1750 / sr; return bp(nz()) * Math.exp(-t / 0.009) * 2.2 + ((ph % 1) < 0.5 ? 0.05 : -0.05) * Math.exp(-t / 0.005); }; }
    else if (kind === 'shaker') { const hp = biquad('hp', 6500, 0.7); len = 0.08; fn = (t) => hp(nz()) * Math.min(1, t / 0.006) * Math.exp(-t / 0.012) * 0.5; }
    else if (kind === 'kick') { len = 0.42; let ph = 0; const lp = biquad('lp', 900, 0.7); fn = (t) => { ph += (44 + 110 * Math.exp(-t / 0.035)) / sr; return Math.sin(TAU * ph) * Math.exp(-t / 0.16) * 1.0 + lp(nz()) * Math.exp(-t / 0.004) * 0.35; }; }
    else if (kind === 'hat') { const hp = biquad('hp', 8000, 0.8), fr = [317, 421, 538, 619, 778, 903].map(f => f * 7.3), ph = fr.map(() => r()); len = 0.07;
      fn = (t) => { let m = 0; for (let i = 0; i < 6; i++) { ph[i] += fr[i] / sr; m += (ph[i] % 1) < 0.5 ? 1 : -1; } return hp(m * 0.12 + nz() * 0.5) * Math.min(1, t / 0.001) * Math.exp(-t / 0.014); }; }
    else if (kind === 'snare') { const bp = biquad('bp', 1900, 0.8); len = 0.22; let ph = 0; fn = (t) => { ph += (150 + 60 * Math.exp(-t / 0.02)) / sr; return bp(nz()) * Math.exp(-t / 0.04) * 0.9 + Math.sin(TAU * ph) * Math.exp(-t / 0.02) * 0.4; }; }
    else if (kind === 'crash') {
      const hp1 = biquad('hp', 5000, 0.7), hp2 = biquad('hp', 3500, 0.5), fr = [205.3, 304.4, 369.6, 522.7, 540, 800].map(f => f * 2.1), ph = fr.map(() => r());
      len = 2.6; fn = (t) => { let m = 0; for (let i = 0; i < 6; i++) { ph[i] += fr[i] / sr; m += (ph[i] % 1) < 0.5 ? 1 : -1; } return (hp1(m * 0.16) + hp2(nz()) * 0.22) * Math.exp(-t / 0.6) * Math.min(1, t / 0.003); };
    } else if (kind === 'timp') {
      const f = mtof(p), lp = biquad('lp', 500, 0.7); len = 1.7; let ph = 0, ph2 = 0;
      fn = (t) => { ph += f * (1 + 0.04 * Math.exp(-t / 0.03)) / sr; ph2 += f * 1.5 / sr; return Math.sin(TAU * ph) * Math.exp(-t / 0.38) * 0.6 + Math.sin(TAU * ph2) * Math.exp(-t / 0.15) * 0.16 + lp(nz()) * Math.exp(-t / 0.02) * 0.5; };
    } else if (kind === 'steprock') {
      const bp = biquad('bp', 1500 + p * 260, 0.8), hp = biquad('hp', 3500, 0.7), f0 = 95 + p * 7; len = 0.17; let ph = 0, grain = 0;
      fn = (t) => { ph += (48 + (f0 - 48) * Math.exp(-t / 0.025)) / sr; if (r() < 0.004) grain = 1; grain *= 0.97;
        return Math.sin(TAU * ph) * Math.exp(-t / 0.03) * 0.9 + bp(nz()) * (0.25 + 0.75 * grain) * Math.exp(-t / 0.022) * 0.9 + (t > 0.012 ? hp(nz()) * Math.exp(-(t - 0.012) / 0.008) * 0.3 : 0); };
    } else if (kind === 'stepbridge') {
      const bp = biquad('bp', 950 + p * 60, 3), f0 = 190 + p * 9, f2 = 620 + p * 30; len = 0.14; let ph = 0, ph2 = 0;
      fn = (t) => { ph += (130 + (f0 - 130) * Math.exp(-t / 0.03)) / sr; ph2 += f2 / sr; return Math.sin(TAU * ph) * Math.exp(-t / 0.03) * 0.8 + (1 - 4 * Math.abs((ph2 % 1) - 0.5)) * Math.exp(-t / 0.012) * 0.3 + bp(nz()) * Math.exp(-t / 0.012) * 1.6; };
    } else if (kind === 'crackle') { const bp = biquad('bp', 2200 + p * 900, 1.5); len = 0.025; fn = (t) => bp(nz()) * Math.exp(-t / (0.002 + p * 0.0012)) * 2.5; }
    else if (kind === 'bubble') { const bp = biquad('bp', 400, 3), f0 = 210 + p * 50; len = 0.16; let ph = 0; fn = (t) => { ph += (70 + (f0 - 70) * Math.exp(-t / 0.04)) / sr; return Math.sin(TAU * ph) * Math.exp(-t / 0.035) * 0.7 + bp(nz()) * Math.exp(-t / 0.02) * 0.6; }; }
    else if (kind === 'heart') { len = 0.45; let ph = 0; fn = (t) => { const tt = t < 0.19 ? t : t - 0.19, a = t < 0.19 ? 0.45 : 0.32; ph += (40 + 22 * Math.exp(-tt / 0.03)) / sr; return Math.sin(TAU * ph) * a * Math.exp(-tt / 0.035) * Math.min(1, tt / 0.003); }; }
    const n = Math.ceil(len * sr), d = new Float32Array(n);
    for (let i = 0; i < n; i++) d[i] = fn(i / sr);
    const fo = Math.min(n, Math.floor(0.01 * sr)); for (let i = 0; i < fo; i++) d[n - 1 - i] *= i / fo;
    b = ctx.createBuffer(1, n, sr); if (b.copyToChannel) b.copyToChannel(d, 0); else b.getChannelData(0).set(d);
    drumCache.set(key, b); return b;
  }
  function hit(buf, t, v, dest, pan, rate) {
    if (SKIP.drums && dest !== ambIn) return;
    const s = ctx.createBufferSource(); s.buffer = buf; if (rate) s.playbackRate.value = rate;
    const g = ctx.createGain(); g.gain.value = v; s.connect(g); out(g, dest, pan); s.start(t); freeOnEnd(s, g); E.stats.notes++;
  }

  /* ---------- instruments (music) ---------- */
  const vibLfo = ctx.createOscillator(); vibLfo.frequency.value = 5.2; const vibAmt = ctx.createGain(); vibAmt.gain.value = 5; vibLfo.connect(vibAmt); vibLfo.start(0);
  const SHAPE = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const x = i / 1023 * 2 - 1; SHAPE[i] = Math.tanh(x * 2.2) / Math.tanh(2.2); }
  function lane(cue, name, rev) { // per-cue layer node with its own reverb send
    const g = ctx.createGain(); g.gain.value = 0; g.connect(cue.gain);
    const s = ctx.createGain(); s.gain.value = rev; g.connect(s); s.connect(musicRevIn);
    return g;
  }
  let musTr = 0;   // the era's key shift, applied only while a music cue schedules its notes
  const I = {
    taiko(t, v, size, dest, pan) { hit(drum('taiko', size > 0.8 ? 1 : size > 0.5 ? 0.6 : 0.35), t, v, dest, pan, 0.98 + rnd() * 0.04); },
    ka(t, v, dest, pan) { hit(drum('ka'), t, v * 0.7, dest, pan); },
    shaker(t, v, dest, pan) { hit(drum('shaker'), t, v * 0.5, dest, pan, 0.95 + rnd() * 0.1); },
    snare(t, v, dest) { hit(drum('snare'), t, v * 0.75, dest); },
    crash(t, v, len, dest) { hit(drum('crash'), t, v, dest); },
    swell(t, len, v, dest) { // reverse cymbal
      const src = ctx.createBufferSource(); src.buffer = NB.white; src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.setValueAtTime(8000, t); f.frequency.exponentialRampToValueAtTime(2500, t + len);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v * 0.22, t + len); g.gain.linearRampToValueAtTime(0.0001, t + len + 0.03);
      src.connect(f); f.connect(g); out(g, dest); src.start(t, rndOff()); src.stop(t + len + 0.1); freeOnEnd(src, f, g);
    },
    timpani(t, m, v, dest) { m += musTr; hit(drum('timp', m), t, v, dest); },
    roll(t, m, len, v0, v1, dest) { const n = Math.max(2, Math.floor(len * 16)); for (let i = 0; i < n; i++) { const k = i / (n - 1); I.timpani(t + k * len, m, lerp(v0, v1, k) * (0.85 + 0.15 * rnd()), dest); } },
    spic(t, m, v, dest, pan) { // spiccato strings
      m += musTr;
      if (SKIP.spic) return;
      const f = mtof(m), lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(1300 + 2200 * v, t); lp.frequency.exponentialRampToValueAtTime(700, t + 0.14); lp.Q.value = 0.8;
      const g = envGain(t, 0.004, v * 0.16, 0.16); lp.connect(g); out(g, dest, pan);
      for (const d of light() ? [0] : [-7, 6]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = d; o.connect(lp); o.start(t); o.stop(t + 0.26); freeOnEnd(o, lp, g); }
      if (v > 0.8) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f / 2; const g3 = ctx.createGain(); g3.gain.value = 0.5; o.connect(g3); g3.connect(lp); o.start(t); o.stop(t + 0.26); }
      E.stats.notes++;
    },
    pad(t, m, dur, v, dest, pan, bright) {
      m += musTr;
      if (SKIP.pad) return;
      const f = mtof(m), lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = bright || 2200; lp.Q.value = 0.4;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v * 0.085, t + Math.min(0.4, dur * 0.4)); g.gain.setValueAtTime(v * 0.085, t + dur); g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.6);
      lp.connect(g); out(g, dest, pan);
      for (const d of light() ? [0] : [-8, 7]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = d; vibAmt.connect(o.detune); o.connect(lp); o.start(t); o.stop(t + dur + 0.65); freeOnEnd(o, lp, g); o.addEventListener && o.addEventListener('ended', () => { try { vibAmt.disconnect(o.detune); } catch (e) {} }); }
      E.stats.notes++;
    },
    brass(t, m, dur, v, dest, pan) {
      m += musTr;
      if (SKIP.brass) return;
      const f = mtof(m), lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 1.6;
      lp.frequency.setValueAtTime(300, t); lp.frequency.exponentialRampToValueAtTime(900 + 2300 * v, t + 0.07); lp.frequency.setTargetAtTime(700 + 1300 * v, t + 0.08, 0.15);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v * 0.16, t + 0.04); g.gain.setTargetAtTime(v * 0.13, t + 0.05, 0.1);
      g.gain.setValueAtTime(v * 0.13, t + Math.max(0.05, dur - 0.02)); g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.16);
      let ws = null; if (light() || v < 0.7) lp.connect(g); else { ws = ctx.createWaveShaper(); ws.curve = SHAPE; lp.connect(ws); ws.connect(g); }
      out(g, dest, pan);
      const vib = ctx.createOscillator(); vib.frequency.value = 5; const vg = ctx.createGain(); vg.gain.setValueAtTime(0, t); vg.gain.linearRampToValueAtTime(7, t + Math.min(0.5, dur)); vib.connect(vg); vib.start(t); vib.stop(t + dur + 0.3);
      if (ws) freeOnEnd(vib, ws); else freeOnEnd(vib);
      for (const [type, d, a] of [['sawtooth', -4, 1], ['sawtooth', 5, 1], ['square', -1200, 0.25]]) {
        if ((light() || v < 0.7) && a < 1) continue;
        const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.detune.setValueAtTime(d - 35, t); o.detune.linearRampToValueAtTime(d, t + 0.06); vg.connect(o.detune);
        const og = ctx.createGain(); og.gain.value = a; o.connect(og); og.connect(lp); o.start(t); o.stop(t + dur + 0.3); freeOnEnd(o, og, lp, g, vg);
      }
      E.stats.notes++;
    },
    harp(t, m, v, dest, pan) {
      m += musTr;
      const f = mtof(m);
      tone(t, f, 1.3, { type: 'triangle', gain: v * 0.13, dest, pan, attack: 0.002 });
      tone(t, f * 2, 0.5, { type: 'sine', gain: v * 0.05, dest, pan, attack: 0.002 });
      E.stats.notes++;
    },
    flute(t, m, dur, v, dest) {
      m += musTr;
      const f = mtof(m), o = ctx.createOscillator(); o.frequency.value = f;
      const vib = ctx.createOscillator(); vib.frequency.value = 5; const vg = ctx.createGain(); vg.gain.setValueAtTime(0, t); vg.gain.linearRampToValueAtTime(f * 0.006, t + 0.35); vib.connect(vg); vg.connect(o.frequency);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v * 0.1, t + 0.08); g.gain.setValueAtTime(v * 0.09, t + dur); g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.2);
      o.connect(g); out(g, dest); o.start(t); o.stop(t + dur + 0.3); vib.start(t); vib.stop(t + dur + 0.3); freeOnEnd(o, g); freeOnEnd(vib, vg);
      noise(t, dur, { type: 'bandpass', freq: f * 2, q: 3, gain: v * 0.025, dest, attack: 0.06 });
    },
    kick(t, v, dest) { hit(drum('kick'), t, v * 0.9, dest); },
    hat(t, v, dest, pan) { hit(drum('hat'), t, v * 0.42, dest, pan, 0.96 + rnd() * 0.08); },
    synth(t, m, dur, v, dest, pan) {   // a bright detuned lead for the modern eras
      m += musTr; const f = mtof(m), lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 3.5;
      lp.frequency.setValueAtTime(700, t); lp.frequency.exponentialRampToValueAtTime(2400 + 2200 * v, t + 0.03); lp.frequency.setTargetAtTime(1500, t + 0.04, 0.2);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v * 0.085, t + 0.012); g.gain.setTargetAtTime(v * 0.065, t + 0.02, 0.1);
      g.gain.setValueAtTime(v * 0.065, t + Math.max(0.03, dur)); g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.12);
      lp.connect(g); out(g, dest, pan);
      for (const [type, d] of light() ? [['square', 0]] : [['square', -7], ['sawtooth', 8]]) { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = d; o.connect(lp); o.start(t); o.stop(t + dur + 0.2); freeOnEnd(o, lp, g); }
      E.stats.notes++;
    },
    sub(t, v, dest) { tone(t, 70, 1.4, { gain: v * 0.6, slide: 28, slideT: 1.2, dest }); },
    conch(t, dur, v, dest) { // 法螺貝
      const f = 155, lp = ctx.createBiquadFilter(); lp.type = 'bandpass'; lp.frequency.value = 620; lp.Q.value = 1.4;
      const lp2 = ctx.createBiquadFilter(); lp2.type = 'bandpass'; lp2.frequency.value = 1150; lp2.Q.value = 2;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v * 0.5, t + 0.12); g.gain.setValueAtTime(v * 0.45, t + dur - 0.2); g.gain.linearRampToValueAtTime(0.0001, t + dur);
      lp.connect(g); lp2.connect(g); out(g, dest);
      const vib = ctx.createOscillator(); vib.frequency.value = 5.5; const vg = ctx.createGain(); vg.gain.value = 12; vib.connect(vg); vib.start(t); vib.stop(t + dur + 0.1);
      for (const [type, d] of [['sawtooth', 0], ['square', 7]]) { const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f * 0.94, t); o.frequency.linearRampToValueAtTime(f, t + 0.15); o.frequency.setValueAtTime(f, t + dur - 0.35); o.frequency.linearRampToValueAtTime(f * 1.06, t + dur); o.detune.value = d; vg.connect(o.detune); o.connect(lp); o.connect(lp2); o.start(t); o.stop(t + dur + 0.1); }
      noise(t, dur, { type: 'bandpass', freq: 900, q: 1.5, gain: v * 0.06, dest, attack: 0.1 });
    },
    choir(t, m, dur, v, dest, vowel) {
      if (SKIP.choir) return;
      m += musTr; while (m > 69) m -= 12; while (m < 41) m += 12;   // stay inside the sampled ensemble range
      const key = (vowel || 'a');
      let base = CHOIR_BASES[0]; for (const b of CHOIR_BASES) if (Math.abs(b - m) < Math.abs(base - m)) base = b;
      const buf = light() ? null : choirCache.get(key + base);
      if (!buf) { E.stats.choirFallback++; if (!light()) requestChoir(key, base); // until the sample is ready (or in light mode): a formant-filtered pad
        const f = mtof(m); const bp1 = ctx.createBiquadFilter(); bp1.type = 'bandpass'; bp1.frequency.value = key === 'o' ? 480 : 720; bp1.Q.value = 3;
        const bp2 = ctx.createBiquadFilter(); bp2.type = 'bandpass'; bp2.frequency.value = key === 'o' ? 850 : 1150; bp2.Q.value = 4;
        const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v * 0.5, t + 0.35); g.gain.setValueAtTime(v * 0.5, t + dur); g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.5);
        bp1.connect(g); bp2.connect(g); out(g, dest);
        for (const d of [-8, 7]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = d; o.connect(bp1); o.connect(bp2); o.start(t); o.stop(t + dur + 0.6); freeOnEnd(o, bp1, bp2, g); }
        return;
      }
      const src = ctx.createBufferSource(); src.buffer = buf; src.playbackRate.value = Math.pow(2, (m - base) / 12);
      const len = buf.duration / src.playbackRate.value;
      const g = ctx.createGain(); const end = Math.min(dur, len - 0.3);
      g.gain.setValueAtTime(v * 0.75, t); g.gain.setValueAtTime(v * 0.75, t + end); g.gain.linearRampToValueAtTime(0.0001, t + end + 0.45);
      src.connect(g); out(g, dest); src.start(t); src.stop(t + end + 0.5); freeOnEnd(src, g);
      E.stats.notes++;
    },
    chant(t, v, kind, dest) {
      const buf = chantCache.get(kind) || renderChant(kind); if (!buf) return;
      const src = ctx.createBufferSource(); src.buffer = buf; const g = ctx.createGain(); g.gain.value = v * 0.9; src.connect(g); out(g, dest); src.start(t); freeOnEnd(src, g);
    }
  };

  function lead(t, m, dur, v, dest, pan) {   // the melody voice of the current era
    const k = E.era.lead;
    if (k === 'flute') I.flute(t, m + 12, dur, v * 1.15, dest);
    else if (k === 'harp') { I.harp(t, m + 12, v * 1.1, dest, pan); if (dur > 0.3) I.harp(t + Math.min(dur * 0.5, 0.23), m + 12, v * 0.55, dest, pan); }
    else if (k === 'synth') I.synth(t, m, dur, v, dest, pan);
    else I.brass(t, m, dur, v, dest, pan);
  }
  E.era = { tr: 0, bpm: 1, lead: 'brass', kit: 'taiko', amb: 'lava' };

  /* ---------- pre-rendered vocal material ---------- */
  function toBuffer(chans, rate) {
    const b = ctx.createBuffer(chans.length, chans[0].length, rate || sr);
    chans.forEach((d, i) => { if (b.copyToChannel) b.copyToChannel(d, i); else b.getChannelData(i).set(d); });
    return b;
  }
  const CHOIR_VOICES = [[0.97, -7, 1, 0], [1.0, 0, 0, 1], [1.05, 6, 0.6, 0.6]], choirParts = new Map();
  function renderChoir(vowel, base) { for (let i = 0; i < CHOIR_VOICES.length; i++) renderChoirVoice(vowel, base, i); return choirCache.get(vowel + base); }
  function renderChoirVoice(vowel, base, i) {   // one ensemble voice per call keeps each slice of main-thread work short
    const key = vowel + base; if (choirCache.has(key)) return;
    const len = 3.7, cr = 22050, n = Math.floor(cr * (len + 0.05));
    let part = choirParts.get(key); if (!part) { part = { L: new Float32Array(n), R: new Float32Array(n), done: new Set() }; choirParts.set(key, part); }
    if (part.done.has(i)) return;
    const L = part.L, R = part.R, vv = CHOIR_VOICES[i];
    const vt = 0.98 + Math.max(0, base - 55) * 0.012;
    {
      const hz = mtof(base) * Math.pow(2, vv[1] / 1200);
      const d = synth(cr, sustainPlan({ vowel, sustain: len, attack: 0.32, release: 0.6 }, { vt: vt * vv[0], breath: 0.12 }),
        { pitchHz: hz, vib: [0.011, 4.8 + i * 0.4], gain: 0.33, breath: 0.1 }, { f0: hz, vt: vt * vv[0], breath: 0.12, rough: 0, jitter: 0.004 }, 100 + base * 7 + i);
      for (let k = 0; k < d.length && k < n; k++) { L[k] += d[k] * vv[2]; R[k] += d[k] * vv[3]; }
    }
    part.done.add(i);
    if (part.done.size === CHOIR_VOICES.length) { choirCache.set(key, toBuffer([L, R], cr)); choirParts.delete(key); }
  }
  const choirQueue = [];
  function requestChoir(vowel, base) { const k = vowel + base; if (!choirCache.has(k) && !choirQueue.some(q => q[0] + q[1] === k)) choirQueue.push([vowel, base]); }
  function renderChant(kind) {
    const text = kind === 'u' ? 'うっ' : 'はっ';
    const vs = [[138, 0.95, 0], [162, 1.0, 0.012], [118, 0.92, 0.02], [180, 1.04, 0.006], [150, 0.98, 0.026], [128, 0.94, 0.016]];
    const parts = vs.map((v, i) => { const d = renderLine(sr, { rate: 1.3, press: 0.85, pitch: [[0, 1], [1, 0.92]], gain: 0.5 }, text, { f0: v[0], vt: v[1], breath: 0.15, rough: 0.1, jitter: 0.015 }, 300 + i); return [d, Math.floor(v[2] * sr)]; });
    const n = Math.max(...parts.map(p => p[0].length + p[1])); const L = new Float32Array(n), R = new Float32Array(n);
    parts.forEach(([d, off], i) => { const pl = 0.3 + 0.7 * ((i % 3) / 2), prr = 1.3 - pl; for (let k = 0; k < d.length; k++) { L[k + off] += d[k] * pl * 0.42; R[k + off] += d[k] * prr * 0.42; } });
    const buf = toBuffer([L, R]); chantCache.set(kind, buf); return buf;
  }
  function lineBuffer(id, vi, profile) {
    const key = id + '|' + vi + '|' + profile;
    let b = lineCache.get(key); if (b) return b;
    const L = LINES[id]; if (!L) return null;
    const text = L.v[vi % L.v.length];
    const d = renderLine(sr, L, text, profile, hashStr(key) + vi * 101);
    b = toBuffer([d]); lineCache.set(key, b); return b;
  }
  E.prewarmList = function () {   // title choir first, then voices (needed early in a run), then the run choir
    const jobs = [], choir = (v) => { if (light()) return; for (const b of CHOIR_BASES) for (let i = 0; i < CHOIR_VOICES.length; i++) jobs.push(() => renderChoirVoice(v, b, i)); };
    choir('o');
    jobs.push(() => renderChant('ha')); jobs.push(() => renderChant('u'));
    for (const id in LINES) for (let i = 0; i < nVariants(LINES[id]); i++) jobs.push(() => lineBuffer(id, i, 'ojisan'));
    for (const p of ['gen', 'takeshi', 'masao', 'noboru', 'hiroshi']) for (const id of ['overtake', 'passed', 'fall', 'hit']) for (let i = 0; i < nVariants(LINES[id]); i++) jobs.push(() => lineBuffer(id, i, p));
    choir('a');
    return jobs;
  };
  E.prewarmSync = function () { const jobs = E.prewarmList(); for (const j of jobs) j(); };
  E.busy = () => false;   // the game sets this: no background rendering while the player is running
  E.prewarm = function () {
    const jobs = E.prewarmList();
    const step = () => {
      if (!E.busy()) { const t0 = Date.now(); while (jobs.length && Date.now() - t0 < 8) jobs.shift()(); }
      if (jobs.length) setTimeout(step, E.busy() ? 250 : 40); else E.prewarmed = true;
    };
    setTimeout(step, 60);
  };

  /* ---------- voice playback ---------- */
  const vBusy = { player: { until: 0, pri: -1 }, npc: { until: 0, pri: -1 } };
  E.line = (id) => LINES[id];
  E.voice = function (id, o) {
    o = o || {};
    const L = LINES[id]; if (!L) return null;
    const ch = o.channel || (o.profile && o.profile !== 'ojisan' ? 'npc' : 'player');
    const t = o.t != null ? o.t : now();
    const busy = vBusy[ch];
    const pri = L.pri || 0;
    if (t < busy.until && pri <= busy.pri && !o.force) return null;
    const vi = o.variant != null ? o.variant : Math.floor(rnd() * nVariants(L));
    const buf = lineBuffer(id, vi, o.profile || 'ojisan'); if (!buf) return null;
    const src = ctx.createBufferSource(); src.buffer = buf;
    const rate = (o.rate || 1) * (pri === 0 ? 0.96 + rnd() * 0.08 : 1);
    src.playbackRate.value = rate;
    const g = ctx.createGain(); g.gain.value = o.gain == null ? 1 : o.gain;
    src.connect(g); const p = out(g, voiceComp, o.pan); p.connect(voiceRevSend);
    // stop a lower-priority line that is still playing
    if (busy.src && t < busy.until) { try { busy.g.gain.setTargetAtTime(0, t, 0.015); busy.src.stop(t + 0.08); } catch (e) {} }
    src.start(t); freeOnEnd(src, g);
    const d = buf.duration / rate;
    busy.until = t + d; busy.pri = pri; busy.src = src; busy.g = g;
    if (pri >= 1 && ch === 'player') { const dk = pri >= 2 ? 0.6 : 0.78; musicDuck.gain.cancelScheduledValues(t); musicDuck.gain.setTargetAtTime(dk, t, 0.03); musicDuck.gain.setTargetAtTime(1, t + d, 0.25); }
    E.stats.voice[id] = (E.stats.voice[id] || 0) + 1;
    const b = L.b == null ? null : Array.isArray(L.b) ? L.b[(vi % L.v.length) % L.b.length] : L.b;
    return { dur: d, bubble: b, variant: vi };
  };

  /* ---------- SFX ---------- */
  const SFX = {
    step(t, o) {
      const w = o.weight || 1, v = (o.gain == null ? 1 : o.gain) * (0.55 + 0.45 * (o.speed || 0.5)), d = o.dest || curDest || sfxIn;
      const br = o.surface === 'bridge';
      hit(drum(br ? 'stepbridge' : 'steprock', Math.floor(rnd() * 4)), t, v * (br ? 0.42 : 0.5) * (w > 1.2 ? 1.25 : 1), d, 0, 0.94 + rnd() * 0.12);
      if (br && rnd() < 0.12) { const o2 = ctx.createOscillator(); o2.type = 'sawtooth'; o2.frequency.setValueAtTime(170, t + 0.03); o2.frequency.linearRampToValueAtTime(230 + rnd() * 60, t + 0.28); const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 6; const g = envGain(t + 0.03, 0.04, v * 0.035, 0.25); o2.connect(bp); bp.connect(g); out(g, d); o2.start(t + 0.03); o2.stop(t + 0.5); freeOnEnd(o2, bp, g); }
      if (o.shoes) tone(t, 2400 + rnd() * 400, 0.04, { gain: v * 0.04, dest: d });
      if (w > 1.2) hit(drum('taiko', 0.35), t, v * 0.18, d, 0, 0.55);
    },
    jump(t) { noise(t, 0.2, { type: 'bandpass', freq: 400, sweep: 1900, q: 1.2, gain: 0.16 }); noise(t, 0.12, { type: 'lowpass', freq: 600, gain: 0.12 }); },
    land(t, o) { const v = clamp((o.v || 4) / 8, 0.3, 1.2); tone(t, 105, 0.22, { gain: 0.5 * v, slide: 38 }); noise(t, 0.12, { type: 'lowpass', freq: 900, gain: 0.22 * v }); noise(t + 0.01, 0.18, { type: 'bandpass', freq: 1800, q: 0.6, gain: 0.08 * v }); },
    ember(t) {
      noise(t, 0.45, { type: 'bandpass', freq: 500, sweep: 3200, q: 0.9, gain: 0.26, rev: 0.3 });
      noise(t, 0.6, { type: 'lowpass', freq: 380, gain: 0.25 });
      [1318.5, 1760, 2637].forEach((f, i) => tone(t + 0.04 + i * 0.05, f, 0.5, { gain: 0.06, rev: 0.4 }));
    },
    shoes(t) {
      [72, 76, 79, 84, 88].forEach((m, i) => tone(t + i * 0.045, mtof(m + 12), 0.35, { type: 'triangle', gain: 0.07, rev: 0.5 }));
      noise(t, 0.4, { type: 'bandpass', freq: 800, sweep: 4000, q: 1, gain: 0.12 });
      tone(t + 0.05, 260, 0.3, { gain: 0.15, slide: 820, slideT: 0.18 });
    },
    shoesEnd(t) { tone(t, 900, 0.3, { gain: 0.16, slide: 280 }); noise(t, 0.25, { type: 'bandpass', freq: 2500, sweep: 700, q: 1.5, gain: 0.08 }); },
    meat(t) { for (let i = 0; i < 2; i++) { noise(t + i * 0.13, 0.07, { type: 'lowpass', freq: 1300, gain: 0.32 }); tone(t + i * 0.13, 150, 0.06, { gain: 0.2, slide: 90 }); } tone(t + 0.33, 330, 0.14, { gain: 0.14, slide: 170 }); },
    wig(t) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(180, t); o.frequency.exponentialRampToValueAtTime(1300, t + 0.55);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(500, t); lp.frequency.exponentialRampToValueAtTime(6000, t + 0.55);
      const g = envGain(t, 0.25, 0.12, 0.35); o.connect(lp); lp.connect(g); out(g, curDest || sfxIn); o.start(t); o.stop(t + 1);
      for (let i = 0; i < 12; i++) tone(t + 0.1 + rnd() * 0.7, 1800 + rnd() * 2600, 0.15, { gain: 0.035, rev: 0.6 });
    },
    wigLost(t) { tone(t, 600, 0.06, { gain: 0.25, slide: 1500 }); const o = ctx.createOscillator(); o.frequency.setValueAtTime(1700, t + 0.08); o.frequency.exponentialRampToValueAtTime(380, t + 0.7); const vib = ctx.createOscillator(); vib.frequency.value = 9; const vg = ctx.createGain(); vg.gain.value = 40; vib.connect(vg); vg.connect(o.frequency); const g = envGain(t + 0.08, 0.02, 0.16, 0.65); o.connect(g); out(g, curDest || sfxIn); o.start(t + 0.08); o.stop(t + 1); vib.start(t); vib.stop(t + 1); },
    drink(t) { for (let i = 0; i < 3; i++) { tone(t + i * 0.16, 190 - i * 12, 0.12, { gain: 0.22, slide: 120 }); noise(t + i * 0.16 + 0.04, 0.06, { type: 'bandpass', freq: 700, q: 4, gain: 0.08 }); } tone(t + 0.55, 520, 0.05, { gain: 0.12, slide: 900 }); },
    hit(t) { tone(t, 85, 0.3, { gain: 0.6, slide: 34 }); noise(t, 0.16, { type: 'lowpass', freq: 900, gain: 0.35 }); noise(t + 0.02, 0.5, { type: 'highpass', freq: 3200, gain: 0.08, attack: 0.04 }); noise(t, 0.03, { type: 'bandpass', freq: 2000, q: 4, gain: 0.2 }); },
    splash(t) { noise(t, 0.55, { type: 'bandpass', freq: 3000, sweep: 600, q: 0.8, gain: 0.3, rev: 0.3 }); for (let i = 0; i < 8; i++) tone(t + rnd() * 0.4, 800 + rnd() * 1600, 0.05, { gain: 0.05, slide: 1600 + rnd() * 900 }); noise(t + 0.1, 0.9, { type: 'highpass', freq: 5000, gain: 0.08, attack: 0.08 }); },
    smash(t) { for (let i = 0; i < 6; i++) noise(t + i * 0.06 + rnd() * 0.03, 0.1, { type: 'lowpass', freq: 500 + rnd() * 400, gain: 0.28 - i * 0.03 }); tone(t, 75, 0.35, { gain: 0.5, slide: 32 }); },
    fallAway(t) { tone(t, 1250, 1.15, { gain: 0.09, slide: 230, slideT: 1.1 }); noise(t, 1.1, { type: 'bandpass', freq: 700, sweep: 2400, q: 0.7, gain: 0.1, attack: 0.35 }); tone(t + 1.15, 95, 0.45, { gain: 0.22, slide: 42 }); noise(t + 1.15, 0.3, { type: 'lowpass', freq: 400, gain: 0.16 }); },
    lava(t) { tone(t, 1300, 0.95, { gain: 0.1, slide: 280, slideT: 0.9 }); noise(t + 0.85, 1.3, { type: 'highpass', freq: 1800, gain: 0.22, attack: 0.02 }); tone(t + 0.85, 160, 0.6, { type: 'sawtooth', gain: 0.1, slide: 40 }); noise(t + 0.85, 0.6, { type: 'lowpass', freq: 300, gain: 0.35 }); },
    flameOut(t) { noise(t, 0.9, { type: 'bandpass', freq: 2600, sweep: 500, q: 1.2, gain: 0.2 }); noise(t + 0.1, 0.4, { type: 'lowpass', freq: 400, gain: 0.25 }); for (let i = 0; i < 8; i++) noise(t + rnd() * 0.6, 0.008, { type: 'bandpass', freq: 3500, q: 2, gain: 0.1 }); },
    tick(t) { tone(t, 1250, 0.05, { gain: 0.12 }); noise(t, 0.025, { type: 'bandpass', freq: 2500, q: 6, gain: 0.1 }); },
    rescue(t) { noise(t, 0.5, { type: 'bandpass', freq: 400, sweep: 3000, q: 1, gain: 0.16 }); [88, 91, 95].forEach((m, i) => tone(t + i * 0.06, mtof(m), 0.4, { gain: 0.06, rev: 0.5 })); },
    bonk(t) { tone(t, 140, 0.15, { gain: 0.4, slide: 60 }); noise(t, 0.05, { type: 'bandpass', freq: 1200, q: 2, gain: 0.2 }); },
    ui(t) { tone(t, 880, 0.05, { type: 'triangle', gain: 0.07 }); noise(t, 0.02, { type: 'bandpass', freq: 3000, q: 4, gain: 0.04 }); },
    back(t) { tone(t, 560, 0.06, { type: 'triangle', gain: 0.07 }); },
    start(t) { I.taiko(t, 0.6, 1, curDest || sfxIn); },
    whoosh(t, o) { noise(t, 0.35, { type: 'bandpass', freq: 500, sweep: 2600, q: 1.4, gain: (o.gain || 1) * 0.14, pan: o.pan }); },
    crowd(t, o) {
      const dur = o.dur || 2.2, v = o.gain || 1;
      for (const [f, q, gg] of [[900, 0.9, 0.5], [2100, 1.3, 0.3]]) {
        const src = ctx.createBufferSource(); src.buffer = NB.pink; src.loop = true;
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q;
        const am = ctx.createGain(); am.gain.value = 0.6; const lfo = ctx.createOscillator(); lfo.frequency.value = 6 + rnd() * 3; const lg = ctx.createGain(); lg.gain.value = 0.35; lfo.connect(lg); lg.connect(am.gain);
        const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v * gg * 0.5, t + 0.25); g.gain.setTargetAtTime(0.0001, t + dur * 0.5, dur * 0.25);
        src.connect(bp); bp.connect(am); am.connect(g); out(g, curDest || sfxIn); const s = ctx.createGain(); s.gain.value = 0.4; g.connect(s); s.connect(sfxRevIn);
        src.start(t, rndOff()); src.stop(t + dur + 1); lfo.start(t); lfo.stop(t + dur + 1);
      }
      for (let i = 0; i < 4; i++) I.chant(t + 0.05 + rnd() * 0.5, v * 0.25, rnd() < 0.5 ? 'ha' : 'u', curDest || sfxIn);
    },
    heart(t) { hit(drum('heart'), t, 1, curDest || ambIn); },
    // mischief items
    pot(t) { for (let i = 0; i < 5; i++) noise(t + i * 0.035 + rnd() * 0.02, 0.09, { type: 'bandpass', freq: 900 + rnd() * 1400, q: 1.4, gain: 0.22 - i * 0.03 }); tone(t, 330, 0.12, { type: 'triangle', gain: 0.22, slide: 200 }); noise(t, 0.2, { type: 'lowpass', freq: 500, gain: 0.25 }); for (let i = 0; i < 5; i++) tone(t + 0.08 + rnd() * 0.3, 1800 + rnd() * 1800, 0.03, { gain: 0.05 }); },
    itemRoll(t) { tone(t, 660, 0.06, { type: 'triangle', gain: 0.08 }); },
    itemGet(t) { [76, 83, 88].forEach((m, i) => tone(t + i * 0.06, mtof(m), 0.3, { type: 'triangle', gain: 0.09, rev: 0.4 })); },
    throw(t) { noise(t, 0.5, { type: 'bandpass', freq: 600, sweep: 2600, q: 2.2, gain: 0.16 }); for (let i = 0; i < 6; i++) noise(t + i * 0.07, 0.05, { type: 'bandpass', freq: 1400 - i * 120, q: 3, gain: 0.08 }); },
    boneHit(t) { tone(t, 520, 0.08, { type: 'square', gain: 0.1, slide: 260 }); tone(t, 180, 0.18, { gain: 0.4, slide: 70 }); noise(t, 0.04, { type: 'bandpass', freq: 2400, q: 3, gain: 0.25 }); for (let i = 0; i < 3; i++) tone(t + 0.12 + i * 0.09, mtof(91 - i * 2), 0.12, { type: 'triangle', gain: 0.05, rev: 0.4 }); },
    burrDrop(t) { noise(t, 0.08, { type: 'lowpass', freq: 700, gain: 0.25 }); noise(t + 0.02, 0.15, { type: 'highpass', freq: 3000, gain: 0.05 }); tone(t, 210, 0.08, { gain: 0.15, slide: 120 }); },
    burrHit(t) { noise(t, 0.12, { type: 'highpass', freq: 2500, gain: 0.18 }); for (let i = 0; i < 4; i++) noise(t + i * 0.02, 0.02, { type: 'bandpass', freq: 3200 + rnd() * 1500, q: 5, gain: 0.12 }); tone(t, 150, 0.15, { gain: 0.3, slide: 70 }); },
    conchBlow(t) { I.conch(t, 1.1, 1.1, curDest || sfxIn); },
    block(t) { [2093, 2794, 3136].forEach((f, i) => tone(t + i * 0.02, f, 0.4, { gain: 0.06, rev: 0.6 })); noise(t, 0.1, { type: 'highpass', freq: 4000, gain: 0.08 }); }
  };
  E.sfx = function (name, o) {
    o = o || {};
    const f = SFX[name]; if (!f) return;
    const t = o.t != null ? o.t : now();
    // per-call level / pan: route this effect's nodes through one gain (+ panner)
    let dest = null;
    if ((o.gain != null && o.gain !== 1 && name !== 'step') || o.pan) { const g = ctx.createGain(); g.gain.value = name === 'step' || o.gain == null ? 1 : o.gain; out(g, sfxIn, o.pan); dest = g; }
    const prev = curDest; if (dest) curDest = dest;
    try { f(t, o); } finally { curDest = prev; }
    E.stats.sfx[name] = (E.stats.sfx[name] || 0) + 1;
  };

  /* ---------- music: cues ---------- */
  const CUES = {
    title: { bpm: 72, bars: 8, lanes: { pad: 0.5, choir: 0.45, brass: 0.35, harp: 0.3, timp: 0.4, bass: 0.35 },
      step(c, s, t, sp) {
        const bar = Math.floor(s / 16), st = s % 16, ch = CH[PROG[bar]], L = c.L, bt = sp * 16;
        if (st === 0) {
          I.pad(t, ch.root + 12, bt, 1.1, L.bass, 0, 900);
          ch.pad.forEach((m, i) => I.pad(t, m, bt, 0.8, L.pad, (i - 1.5) * 0.35, 2000));
          if (c.loop > 0 || bar >= 2) ch.choir.forEach(m => I.choir(t, m, bt, 0.6, L.choir, 'o'));
          if (bar === 0 || bar === 4) I.timpani(t, 38, 0.7, L.timp);
          if (bar === 3 || bar === 7) I.roll(t + sp * 8, 38, sp * 8, 0.1, 0.5, L.timp);
          if (c.loop % 2 === 1 && (bar === 3 || bar === 7)) I.swell(t + sp * 8, sp * 8, 0.8, L.timp);
        }
        if (st % 2 === 0) { const tones = ch.pad; const seq = [0, 1, 2, 3, 2, 1, 2, 3]; I.harp(t, tones[seq[(st / 2) % 8]] + 12, 0.7, L.harp, (st / 8) - 1); }
        for (const n of THEME) if (n.step === s) { I.brass(t, n.m, n.len * sp * 0.95, 0.75, L.brass, -0.15); if (c.loop % 2 === 1) I.brass(t, n.m - 12, n.len * sp * 0.95, 0.45, L.brass, 0.2); }
      } },
    run: { bpm: 132, bars: 8, lanes: { drums: 0.25, bass: 0.3, ost: 0.25, pad: 0.4, brass: 0.35, chant: 0.4, choir: 0.5, cym: 0.5 },
      levels(I) { return { drums: I < 0.5 ? 0.6 : 1, bass: I < 0.5 ? 0.5 : 0.9, ost: I >= 1 ? 1 : 0, pad: I >= 1 ? 0.6 : 0.3, brass: I >= 2 ? 1 : 0, chant: I >= 2 ? 1 : 0, choir: I >= 3 ? 1 : 0, cym: I >= 3 ? 1 : I >= 2 ? 0.5 : 0 }; },
      step(c, s, t, sp) {
        const bar = Math.floor(s / 16), st = s % 16, ch = CH[PROG[bar]], L = c.L, on = c.on;
        // taiko groove
        const kit = E.era.kit;
        if (on.drums && kit === 'march') {   // a brass-band march: bass drum, snare, rolls
          if (st === 0 || st === 8) I.taiko(t, st === 0 ? 1 : 0.8, 1, L.drums, 0);
          if (st === 4 || st === 12) I.snare(t, 0.9, L.drums);
          if (on.ost && (st === 10 || st === 14 || st === 15)) I.snare(t, 0.42, L.drums);
          if (on.ost && st % 2 === 0) I.shaker(t, st % 4 === 2 ? 1 : 0.6, L.drums, 0.4);
          if (on.brass && bar === 7 && st >= 8) I.snare(t, 0.35 + (st - 8) * 0.07, L.drums);
        } else if (on.drums && kit === 'beat') {   // four on the floor
          if (st % 4 === 0) I.kick(t, st === 0 ? 1 : 0.85, L.drums);
          if (st === 4 || st === 12) I.snare(t, 0.8, L.drums);
          if (on.ost && st % 2 === 0) I.hat(t, st % 4 === 2 ? 1 : 0.55, L.drums, 0.3);
          if (on.brass && st % 4 === 2) I.hat(t, 0.5, L.drums, -0.3);
          if (on.brass && bar === 7 && st >= 8) I.snare(t, 0.3 + (st - 8) * 0.07, L.drums);
        } else if (on.drums) {
          if (st === 0 || st === 6 || st === 10) I.taiko(t, st === 0 ? 1 : 0.78, 1, L.drums, 0);
          if (on.ost && (st === 4 || st === 12)) I.taiko(t, 0.72, 0.6, L.drums, st === 4 ? -0.3 : 0.3);
          if (on.ost && st % 2 === 0) I.shaker(t, st % 4 === 2 ? 1 : 0.6, L.drums, 0.4);
          if (on.brass && (st === 3 || st === 7 || st === 11 || st === 15)) I.ka(t, 0.6, L.drums, -0.4);
          if (on.brass && bar === 7 && st >= 8) I.taiko(t, 0.35 + (st - 8) * 0.07, 0.4, L.drums, (st % 2 ? 0.4 : -0.4));
        }
        // bass + pad
        if (st === 0) { I.pad(t, ch.root + 12, sp * 16, 1.2, L.bass, 0, 700); I.pad(t, ch.root, sp * 16, 0.9, L.bass, 0, 400); if (on.pad) ch.pad.forEach((m, i) => I.pad(t, m, sp * 16, 0.7, L.pad, (i - 1.5) * 0.4, 1800)); }
        // ostinato 3+3+2 accents
        if (on.ost) { const acc = st === 0 || st === 3 || st === 6 || st === 8 || st === 11 || st === 14; const m = st === 6 || st === 14 ? ch.ost[1] : st === 10 ? ch.ost[2] : ch.ost[0]; I.spic(t, m, acc ? 1 : 0.55, L.ost, (st % 2 ? 0.35 : -0.35)); }
        // melody
        if (on.brass) for (const n of THEME) if (n.step === s) { lead(t, n.m, n.len * sp * 0.92, 0.85, L.brass, -0.1); if (on.choir) lead(t, n.m - 12, n.len * sp * 0.92, 0.6, L.brass, 0.25); }
        if (on.chant && st === 12 && (bar === 3 || bar === 7 || (on.choir && (bar === 1 || bar === 5)))) I.chant(t, 0.8, 'ha', L.chant);
        if (on.chant && on.choir && st === 14 && bar === 7) I.chant(t, 0.7, 'u', L.chant);
        if (on.choir && st === 0) ch.choir.forEach(m => I.choir(t, m, sp * 16, 0.55, L.choir, 'a'));
        if (on.cym && st === 0 && (bar === 0 || bar === 4)) I.crash(t, on.choir ? 1 : 0.6, 2.4, L.cym);
        if (on.cym && on.choir && bar === 7 && st === 8) I.swell(t, sp * 8, 1, L.cym);
      } },
    wig: { bpm: 150, bars: 4, lanes: { drums: 0.25, bass: 0.3, ost: 0.25, brass: 0.35, choir: 0.5, cym: 0.45, chant: 0.4 },
      step(c, s, t, sp) {
        const bar = Math.floor(s / 16), st = s % 16, ch = CH[WIG_PROG[bar]], L = c.L;
        if (st % 4 === 0) I.taiko(t, st === 0 ? 1 : 0.8, 1, L.drums);
        if (st % 4 === 2) I.taiko(t, 0.55, 0.55, L.drums, (st === 2 ? -0.3 : 0.3));
        if (st === 4 || st === 12) I.snare(t, 0.9, L.drums);
        if (st % 2 === 0) I.shaker(t, 1, L.drums, 0.3);
        if (st === 0) { I.pad(t, ch.root + 12, sp * 16, 1.2, L.bass, 0, 800); ch.choir.forEach(m => I.choir(t, m, sp * 16, 0.6, L.choir, 'a')); }
        const m = [ch.ost[0], ch.ost[0] + 12, ch.ost[1], ch.ost[0] + 12][st % 4]; I.spic(t, m, st % 4 === 0 ? 1 : 0.6, L.ost, st % 2 ? 0.35 : -0.35);
        for (const n of WIG_MEL) if (n.step === s) { lead(t, n.m, n.len * sp * 0.9, 1, L.brass, -0.1); lead(t, n.m - 12, n.len * sp * 0.9, 0.6, L.brass, 0.25); }
        if (st === 0 && bar === 0) I.crash(t, 1, 2.2, L.cym);
        if (st % 2 === 0 && bar !== 0) I.shaker(t, 0.8, L.cym, -0.5);
        if (st === 12 && bar === 3) I.chant(t, 0.9, 'ha', L.chant);
      } },
    brk: { bpm: 66, bars: 4, lanes: { pad: 0.5, harp: 0.35, flute: 0.4, drum: 0.3 },
      step(c, s, t, sp) {
        const bar = Math.floor(s / 16), st = s % 16, ch = CH[BREAK_PROG[bar]], L = c.L;
        if (st === 0) { ch.pad.forEach((m, i) => I.pad(t, m, sp * 16, 0.55, L.pad, (i - 1.5) * 0.3, 900)); I.pad(t, ch.root + 12, sp * 16, 0.8, L.pad, 0, 500); I.taiko(t, 0.25, 0.6, L.drum); }
        if (st === 8) I.taiko(t, 0.15, 0.6, L.drum);
        if (st % 2 === 0) { const seq = [0, 1, 2, 3, 2, 1, 2, 1]; I.harp(t, ch.pad[seq[(st / 2) % 8]] + 12, 0.55, L.harp, (st / 8) - 1); }
        if (c.loop % 2 === 0) for (const n of BREAK_MEL) if (n.step === s) I.flute(t, n.m, n.len * sp * 0.95, 0.8, L.flute);
      } },
    clear: { bpm: 112, bars: 3, once: true, next: 'result', lanes: { brass: 0.35, choir: 0.5, drums: 0.3, pad: 0.4, cym: 0.5 },
      step(c, s, t, sp) {
        const bar = Math.floor(s / 16), st = s % 16, L = c.L;
        const chords = ['D', 'A', 'D', 'D'], ch = CH[chords[bar]];
        for (const n of CLEAR_MEL) if (n.step === s) { I.brass(t, n.m, n.len * sp * 0.95, 1, L.brass, -0.1); I.brass(t, n.m - 12, n.len * sp * 0.95, 0.7, L.brass, 0.2); }
        if (st === 0 && bar < 3) { ch.choir.forEach(m => I.choir(t, m, sp * 16, 0.7, L.choir, 'a')); ch.pad.forEach((m, i) => I.pad(t, m, sp * 16, 0.8, L.pad, (i - 1.5) * 0.4, 2500)); I.taiko(t, 1, 1, L.drums); }
        if (bar === 0 && (st === 4 || st === 8 || st === 12)) I.taiko(t, 0.7, 0.6, L.drums);
        if (bar === 1 && st >= 8) I.timpani(t, 45, 0.25 + (st - 8) * 0.07, L.drums);
        if (bar === 2 && st === 0) { I.crash(t, 1, 3, L.cym); I.sub(t, 0.8, L.drums); I.chant(t, 0.9, 'ha', L.drums); }
        if (bar === 2 && st >= 8) I.timpani(t, 38, 0.2 + (st - 8) * 0.06, L.drums);
      } },
    result: { bpm: 72, bars: 8, lanes: { pad: 0.5, harp: 0.3, brass: 0.35, choir: 0.45 },
      step(c, s, t, sp) {
        const bar = Math.floor(s / 16), st = s % 16, ch = CH[PROG[bar]], L = c.L;
        if (st === 0) { ch.pad.forEach((m, i) => I.pad(t, m, sp * 16, 0.6, L.pad, (i - 1.5) * 0.35, 1500)); if (bar >= 4) ch.choir.forEach(m => I.choir(t, m, sp * 16, 0.4, L.choir, 'o')); }
        if (st % 2 === 0) { const seq = [0, 1, 2, 3, 2, 1, 2, 3]; I.harp(t, ch.pad[seq[(st / 2) % 8]] + 12, 0.55, L.harp, (st / 8) - 1); }
        if (c.loop % 2 === 1) for (const n of THEME) if (n.step === s) lead(t, n.m, n.len * sp * 0.95, 0.5, L.brass, -0.15);
      } },
    fail: { bpm: 84, bars: 2, once: true, next: 'soft', lanes: { brass: 0.3, drums: 0.3 },
      step(c, s, t, sp) {
        const L = c.L;
        const seq = { 0: [55, 4], 4: [54, 4], 8: [53, 4], 12: [52, 20] };   // G3 F#3 F3 E3 — the comic "wah wah wah waaah"
        if (seq[s]) { const [m, len] = seq[s]; I.brass(t, m, len * sp * 0.9, 0.9, L.brass, 0); I.brass(t, m - 12, len * sp * 0.9, 0.6, L.brass, 0); }
        if (s === 12) I.timpani(t, 40, 0.5, L.drums);
      } },
    soft: { bpm: 60, bars: 4, lanes: { pad: 0.5, harp: 0.3 },
      step(c, s, t, sp) {
        const bar = Math.floor(s / 16), st = s % 16, ch = CH[['Dm', 'Bb', 'Gm', 'A'][bar]], L = c.L;
        if (st === 0) ch.pad.forEach((m, i) => I.pad(t, m, sp * 16, 0.45, L.pad, (i - 1.5) * 0.3, 900));
        if (st % 4 === 0) I.harp(t, ch.pad[(st / 4) % 4] + 12, 0.4, L.harp, 0);
      } }
  };
  E.CUES = CUES;
  const ERA_CUES = { run: 1, wig: 1, brk: 1, clear: 1, result: 1, fail: 1, soft: 1 }, ERA_TEMPO = { run: 1, wig: 1 };
  const mus = { cur: null, state: { intensity: 1, final: false, danger: false, paused: false, drunk: false } };
  function startCue(name, t, fade) {
    const def = CUES[name];
    const old = mus.cur;
    if (old) { old.gain.gain.cancelScheduledValues(t); old.gain.gain.setValueAtTime(old.gain.gain.value || 1, t); old.gain.gain.linearRampToValueAtTime(0.0001, t + (fade == null ? 0.5 : fade)); const og = old.gain; setTimeoutSafe(() => { try { og.disconnect(); } catch (e) {} }, 6000); }
    if (!def) { mus.cur = null; E.stats.cues.push(name); return; }
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(1, t + (fade == null ? 0.25 : Math.max(0.02, fade * 0.5))); g.connect(musicIn);
    const c = { name, def, gain: g, L: {}, on: {}, step: 0, loop: 0, nextT: t + 0.02, bpm: def.bpm * (ERA_TEMPO[name] ? E.era.bpm : 1) };
    for (const k in def.lanes) c.L[k] = lane(c, k, def.lanes[k]);
    applyLevels(c, t, true);
    mus.cur = c; E.stats.cues.push(name);
  }
  function setTimeoutSafe(fn, ms) { if (!E.offline && typeof setTimeout === 'function') setTimeout(fn, ms); }
  function applyLevels(c, t, snap) {
    const s = mus.state;
    const I0 = s.danger ? Math.min(1, s.intensity) : (s.final ? Math.max(2, s.intensity) + (s.intensity >= 2 ? 1 : 0) : s.intensity);
    const lv = c.def.levels ? c.def.levels(Math.min(3, I0)) : null;
    for (const k in c.L) {
      const v = lv ? (lv[k] == null ? 1 : lv[k]) : 1;
      c.on[k] = v > 0.01;
      if (snap) c.L[k].gain.setValueAtTime(v, t); else c.L[k].gain.setTargetAtTime(v, t, 0.5);
    }
    if (c.name === 'run') c.bpm = (s.final ? 140 : 132) * E.era.bpm;
  }
  E.cue = function (name, o) {
    o = o || {};
    const t = o.t != null ? o.t : now();
    if (mus.cur && mus.cur.name === name && !o.restart) return;
    if (!mus.cur && name === 'silent') return;
    startCue(name === 'silent' ? null : name, t, o.fade);
  };
  E.curCue = () => (mus.cur ? mus.cur.name : 'silent');
  E.setMusicState = function (st, o) {
    const t = (o && o.t != null) ? o.t : now();
    const s = mus.state; let changed = false;
    for (const k in st) if (s[k] !== st[k]) { s[k] = st[k]; changed = true; }
    if (!changed) return;
    if (mus.cur) applyLevels(mus.cur, t, false);
    musicFilter.frequency.setTargetAtTime(s.paused ? 650 : s.danger ? 1300 : 20000, t, s.paused ? 0.05 : 0.3);
    musicPause.gain.setTargetAtTime(s.paused ? 0.55 : 1, t, 0.1);
    wobWet.gain.setTargetAtTime(s.drunk ? 1 : 0, t, 0.3); wobDry.gain.setTargetAtTime(s.drunk ? 0 : 1, t, 0.3);
  };
  E.sting = function (name, o) {
    o = o || {};
    if (E.musicOff) return;   // stings are part of the music
    const t = o.t != null ? o.t : now();
    const d = ctx.createGain(); d.gain.value = 1; d.connect(musicIn); const rs = ctx.createGain(); rs.gain.value = 0.4; d.connect(rs); rs.connect(musicRevIn);
    const chord = (ms, len, v) => ms.forEach((m, i) => I.brass(t, m, len, v, d, (i - 1.5) * 0.3));
    switch (name) {
      case 'ready': I.roll(t, 38, o.dur || 0.8, 0.12, 0.7, d); for (let i = 0; i < 8; i++) I.taiko(t + i * (o.dur || 0.8) / 8, 0.2 + i * 0.08, 0.6, d, (i % 2 ? 0.3 : -0.3)); break;
      case 'go': I.taiko(t, 1, 1, d); I.taiko(t, 0.8, 0.6, d); chord([62, 65, 69, 74], 0.5, 1); I.crash(t, 0.9, 2.2, d); I.chant(t + 0.02, 0.8, 'ha', d); if (o.conch) I.conch(t, 1.3, 0.9, d); break;
      case 'gate': I.taiko(t, 1, 1, d); I.sub(t, 0.7, d); chord([65, 69, 72, 77], 1.4, 1); I.crash(t, 1, 3, d); I.chant(t + 0.05, 0.8, 'ha', d); break;
      case 'wigStart': I.taiko(t, 1, 1, d); I.sub(t, 0.9, d); chord([62, 66, 69, 74], 0.9, 1); I.crash(t, 1, 2.6, d); [50, 57, 62, 66].forEach(m => I.choir(t, m, 1.2, 0.7, d, 'a')); break;
      case 'wigEnd': { const o2 = ctx.createOscillator(); o2.type = 'sawtooth'; o2.frequency.setValueAtTime(mtof(74), t); o2.frequency.exponentialRampToValueAtTime(mtof(50), t + 0.45); const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800; const g = envGain(t, 0.01, 0.12, 0.45); o2.connect(lp); lp.connect(g); g.connect(d); o2.start(t); o2.stop(t + 0.8); break; }
      case 'overtake': I.brass(t, 69, 0.12, 0.6, d, 0); I.brass(t + 0.13, 74, 0.3, 0.7, d, 0); break;
      case 'clearHit': I.taiko(t, 1, 1, d); chord([62, 66, 69, 74], 0.8, 1); I.crash(t, 1, 3, d); break;
    }
    E.stats.sfx['sting:' + name] = (E.stats.sfx['sting:' + name] || 0) + 1;
  };

  /* ---------- ambience ---------- */
  function loopSrc(buf, dest) { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.connect(dest); s.start(0, rndOff()); return s; }
  const amb = {};
  { // lava rumble
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 150; const g = ctx.createGain(); g.gain.value = 0; lp.connect(g); g.connect(ambIn); loopSrc(NB.brown, lp); amb.lava = g; amb.lavaF = lp;
    // wind
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 600; bp.Q.value = 0.6; const wg = ctx.createGain(); wg.gain.value = 0; bp.connect(wg); wg.connect(ambIn); loopSrc(NB.pink, bp); amb.wind = wg; amb.windF = bp;
    // torch fire: hiss + roar
    const fb = ctx.createBiquadFilter(); fb.type = 'bandpass'; fb.frequency.value = 1300; fb.Q.value = 0.5; const fg = ctx.createGain(); fg.gain.value = 0; fb.connect(fg); fg.connect(ambIn); loopSrc(NB.white, fb); amb.fire = fg;
    const rl = ctx.createBiquadFilter(); rl.type = 'lowpass'; rl.frequency.value = 380; const rg = ctx.createGain(); rg.gain.value = 0; rl.connect(rg); rg.connect(ambIn); loopSrc(NB.brown, rl); amb.roar = rg;
  }
  const AMB = { lava: { f: 150, g: 1, bub: 1, wind: 0 }, water: { f: 520, g: 0.55, bub: 0, wind: 0 }, city: { f: 230, g: 0.5, bub: 0, wind: 0.03 }, sky: { f: 120, g: 0.12, bub: 0, wind: 0.1 } };
  const ambK = () => AMB[E.era.amb] || AMB.lava;
  const ambState = { active: false, speed: 0, flame: 1, wind: false, campfire: false, danger: false };
  let nextCrackle = 0, nextBubble = 0, nextHeart = 0, nextGust = 0;
  E.ambience = function (s) {
    Object.assign(ambState, s);
    const t = now(), a = ambState.active ? 1 : 0;
    const sp = ambState.speed, fl = ambState.flame;
    const K = ambK(); amb.lavaF.frequency.setTargetAtTime(K.f, t, 0.3);
    amb.lava.gain.setTargetAtTime(a * (ambState.campfire ? 0.12 : 0.26 * K.g), t, 0.3);
    amb.wind.gain.setTargetAtTime(a * (0.015 + K.wind + 0.16 * sp * sp + (ambState.wind ? 0.22 : 0)), t, 0.2);
    amb.windF.frequency.setTargetAtTime(380 + 1100 * sp + (ambState.wind ? 300 : 0), t, 0.3);
    amb.fire.gain.setTargetAtTime(a * (ambState.campfire ? 0.07 : 0.02 + 0.05 * fl), t, 0.2);
    amb.roar.gain.setTargetAtTime(a * (ambState.campfire ? 0.3 : fl > 0 ? 0.04 + 0.22 * sp * fl : 0), t, 0.2);
  };
  function ambTick(t0, t1) {
    if (!ambState.active) return;
    const fl = ambState.flame;
    const rate = ambState.campfire ? 11 : fl > 0 ? 2 + 9 * fl : 0;
    if (nextCrackle < t0) nextCrackle = t0;
    while (rate > 0 && nextCrackle < t1) { hit(drum('crackle', Math.floor(rnd() * 4)), nextCrackle, (ambState.campfire ? 0.1 : 0.045 + 0.045 * fl) * (0.4 + rnd()), ambIn, (rnd() - 0.5) * 0.5, 0.8 + rnd() * 0.5); nextCrackle += -Math.log(1 - rnd()) / rate; }
    if (nextBubble < t0) nextBubble = t0 + rnd();
    while (ambK().bub && nextBubble < t1) { hit(drum('bubble', Math.floor(rnd() * 3)), nextBubble, 0.08 + rnd() * 0.06, ambIn, (rnd() - 0.5) * 1.6, 0.85 + rnd() * 0.3); nextBubble += 0.35 + rnd() * 1.1; }
    if (ambState.danger) { if (nextHeart < t0) nextHeart = t0; while (nextHeart < t1) { SFX.heart(nextHeart); E.stats.sfx.heart = (E.stats.sfx.heart || 0) + 1; nextHeart += 0.82; } }
  }

  E.setEra = function (m) {
    E.era = Object.assign({ tr: 0, bpm: 1, lead: 'brass', kit: 'taiko', amb: 'lava' }, m || {});
    const c = mus.cur; if (c) { c.bpm = c.def.bpm * (ERA_TEMPO[c.name] ? E.era.bpm : 1); applyLevels(c, now(), false); }
    E.ambience({});
  };

  /* ---------- scheduler ---------- */
  const LOOK = 0.18;
  E.update = function (tNow) {
    if (E.offline && tNow != null) E.clock = tNow;
    const t = now(), until = t + LOOK;
    const c = mus.cur;
    if (c) {
      let guard = 0;
      while (c.nextT < until && guard++ < 64) {
        const sp = 60 / c.bpm / 4;
        if (c.nextT >= t - 0.05 && !E.musicOff) { musTr = ERA_CUES[c.name] ? E.era.tr : 0; try { c.def.step(c, c.step, c.nextT, sp); } finally { musTr = 0; } }   // music off: keep time, play nothing
        c.nextT += sp; c.step++;
        if (c.step >= c.def.bars * 16) {
          c.step = 0; c.loop++;
          if (c.def.once) { const nx = c.def.next; startCue(nx, c.nextT, 1.2); break; }
        }
      }
    }
    if (!E.offline && choirQueue.length && !E._choirBusy && !E.busy()) { E._choirBusy = true; setTimeoutSafe(() => { const q = choirQueue.shift(); if (q) renderChoir(q[0], q[1]); E._choirBusy = false; }, 0); }
    ambTick(Math.max(t, E._ambT || 0), until); E._ambT = until;
  };
  return E;
}

global.TorchAudio = { createEngine, renderLine, parseKana, buildPlan, segPlan, nVariants, LINES, PROFILES, VOW, mtof, THEME, CH, PROG };
})(typeof window !== 'undefined' ? window : globalThis);
