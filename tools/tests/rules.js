// Rule-level acceptance checks (v14: top speed 10 m/s, top gear when MOMENTUM is full) on the simulation core (reconstructed from the earlier session's suite).
const T = require('./core.js');
const { CONFIG: C, STEP } = T;
const results = [];
const check = (id, name, ok, detail) => { results.push({ id, name, ok: !!ok, detail }); };
const NONE = () => ({ taps: 0, jumpEdge: false, jumpHeld: false, left: false, right: false, brake: false });
const flat = () => ({ L: 3000, short: false, secLen: 500, segs: [{ z0: -40, z1: 3046, y: 0, hw: 3.5, type: 'rock' }], obstacles: [], hazards: [], pickups: [], checkpoints: [0, 500, 1000, 1500, 2000, 2500], tutorial: {} });
const runFor = (run, secs, inpFn) => { const n = Math.round(secs / STEP); for (let i = 0; i < n; i++) { T.simStep(run, inpFn(i * STEP, i), STEP); run.events.length = 0; if (run.result) return run.result; } return null; };
const tapper = (rate) => { let acc = 0; return () => { const o = NONE(); acc += rate * STEP; while (acc >= 1) { o.taps++; acc--; } return o; }; };

{ const run = T.newRun(flat()); runFor(run, 2, NONE); check('IN-01', '押しっぱなし（打数0）では前進しない', run.p.vz === 0 && run.p.z === 2, `vz=${run.p.vz}`); }
{ const run = T.newRun(flat()); runFor(run, 1, tapper(12)); const used = 100 - run.stamina;
  check('IN-02', '12打/秒でもスタミナ消費は6打/秒相当まで', used <= 6 * 1.25 * 1.15 + 1e-6, `1秒で消費 ${used.toFixed(2)}`);
  check('IN-03', '入力率の上限 6打/秒（u≤1）', run.u <= 1 && run.rate <= 6, `rate=${run.rate.toFixed(2)} u=${run.u.toFixed(2)}`); }
{ const run = T.newRun(flat()); runFor(run, 3, tapper(6)); check('ST-01', '6打/秒で最高速 ' + C.move.maxSpeed + ' m/s 付近', run.p.vz > C.move.maxSpeed * 0.93, `vz=${run.p.vz.toFixed(2)}`);
  runFor(run, 20, tapper(6)); check('ST-02', 'スタミナ0でも即死せず、疲労倍率0.55で走れる', !run.result && run.stamina === 0 && Math.abs(run.p.vz - C.move.maxSpeed * C.fatigue.base) < 0.6, `stamina=${run.stamina.toFixed(1)} vz=${run.p.vz.toFixed(2)}`);
  const before = run.stamina; const lt = run.lastTapT; let mid = null;
  runFor(run, 1.25, () => { if (mid === null && run.t - lt >= 0.24) mid = run.stamina; return NONE(); });
  const expect = (run.t - lt - 0.25) * 16;
  check('ST-03', '連打停止0.25秒後から16/秒で回復', mid === before && Math.abs(run.stamina - expect) < 0.4, `→ ${run.stamina.toFixed(1)}（期待 ${expect.toFixed(1)}）`); }
{ const run = T.newRun(flat()); const tp = tapper(6); runFor(run, 1.9, tp); const m0 = run.momentum; runFor(run, 4.5, tp);
  check('ST-04', 'u≥0.85を2秒維持後にMOMENTUMが貯まり、最大2.5秒', m0 === 0 && run.momentum > 2.4 && run.momentum <= 2.5, `1.9秒:${m0} 6.4秒:${run.momentum.toFixed(2)}`);
  const vBefore = run.p.vz; runFor(run, 1.5, NONE);
  check('ST-05', '連打停止中はMOMENTUMを消費して速度維持', Math.abs(run.p.vz - vBefore) < 0.6 && run.momentum > 0.9 && run.momentum < 1.35, `vz=${run.p.vz.toFixed(2)} mom=${run.momentum.toFixed(2)}`);
  runFor(run, 0.1, () => Object.assign(NONE(), { brake: true }));
  check('ST-06', 'ブレーキでMOMENTUM即時解除・減速', run.momentum === 0 && run.p.vz < vBefore - 1.5, `mom=${run.momentum} vz=${run.p.vz.toFixed(2)}`); }
{ const run = T.newRun(flat()); let peak = 0; T.simStep(run, Object.assign(NONE(), { jumpEdge: true, jumpHeld: true }), STEP);
  runFor(run, 1.2, () => { peak = Math.max(peak, run.p.y); return Object.assign(NONE(), { jumpHeld: true }); });
  const run2 = T.newRun(flat()); let peak2 = 0; T.simStep(run2, Object.assign(NONE(), { jumpEdge: true, jumpHeld: true }), STEP);
  runFor(run2, 1.2, () => { peak2 = Math.max(peak2, run2.p.y); return NONE(); });
  check('JP-01', 'SHIFT長押しで大ジャンプ、短押しで小ジャンプ', peak > 1.8 && peak2 < 0.8, `長押し ${peak.toFixed(2)}m / 短押し ${peak2.toFixed(2)}m`);
  const run3 = T.newRun(flat()); T.simStep(run3, Object.assign(NONE(), { jumpEdge: true, jumpHeld: true }), STEP);
  runFor(run3, 2, () => Object.assign(NONE(), { jumpHeld: true }));
  check('JP-02', '1回の押下から1ジャンプのみ', run3.p.grounded && run3.p.y === 0, `grounded=${run3.p.grounded}`); }
{ const c = flat(); c.pickups = [{ type: 'shoes', z: 10, x: 0, y: 1 }]; const run = T.newRun(c);
  runFor(run, 1.6, tapper(6)); const s0 = run.stamina; const shoesOn = run.buffs.shoes > 0;
  const tapsBefore = run.stats.taps; runFor(run, 2, tapper(6));
  check('BF-01', '靴: AUTOで最高速、スタミナ不消費・打数は加算', shoesOn && run.p.vz > 7.9 && run.stamina >= s0 && run.stats.taps > tapsBefore, `vz=${run.p.vz.toFixed(2)}`);
  let endZ = null, graceV = null; const z0s = run.stats.shoesEnds;
  runFor(run, 12, () => { if (endZ === null && run.stats.shoesEnds > z0s) endZ = run.t; if (endZ !== null && graceV === null && run.t - endZ > 0.7) graceV = run.p.vz; return NONE(); });
  check('BF-02', '靴終了後 0.75秒の速度維持猶予 → 手動に戻る', run.stats.shoesEnds === 1 && graceV > 7.9 && run.p.vz < 0.5, `猶予 vz=${graceV && graceV.toFixed(2)} → ${run.p.vz.toFixed(2)}`); }
{ const c = flat(); c.pickups = [{ type: 'shoes', z: 10, x: 0, y: 1 }, { type: 'wig', z: 30, x: 0, y: 1, style: 'afro' }, { type: 'alcohol', z: 60, x: 0, y: 1 }, { type: 'shoes', z: 90, x: 0, y: 1 }]; const run = T.newRun(c);
  runFor(run, 5, tapper(6)); const saved = run.buffs.shoesPaused;
  check('BF-03', 'カツラ中は靴の残り時間を停止して保存', run.buffs.wig > 0 && run.buffs.shoes === 0 && saved > 0, `shoesPaused=${saved.toFixed(2)}`);
  runFor(run, 4, NONE);
  check('BF-04', 'カツラ中の酒は取得数のみ加算・デバフなし', run.stats.alcohol === 1 && run.buffs.alcohol === 0, `alcohol=${run.stats.alcohol}`);
  while (run.p.z < 92) { T.simStep(run, NONE(), STEP); run.events.length = 0; }
  check('BF-05', 'カツラ中に靴を再取得 → 保存時間を10秒へ戻す', Math.abs(run.buffs.shoesPaused - 10) < 1e-9 && run.buffs.wig > 0, `shoesPaused=${run.buffs.shoesPaused}`);
  let resumed = null; runFor(run, 12, () => { if (resumed === null && run.buffs.wig === 0) resumed = run.buffs.shoes; return NONE(); });
  check('BF-06', 'カツラ終了後に靴が再開', resumed !== null && resumed > 9.5, `再開時=${resumed && resumed.toFixed(2)}`); }
{ const c = flat(); c.pickups = [{ type: 'alcohol', z: 10, x: 0, y: 1 }, { type: 'wig', z: 20, x: 0, y: 1, style: 'afro' }]; const run = T.newRun(c);
  runFor(run, 2.5, tapper(6)); const capOk = run.p.vz <= C.move.maxSpeed * C.items.alcoholSpeedCap + 1e-6 && run.buffs.alcohol > 0; runFor(run, 3, tapper(6));
  check('BF-07', '酒: 速度上限0.65倍 → カツラ取得で解除', capOk && run.buffs.alcohol === 0 && run.buffs.wig > 0, `cap=${capOk}`); }
{ const c = flat(); c.pickups = [{ type: 'meat', z: 10, x: 0, y: 1 }, { type: 'meat', z: 40, x: 0, y: 1 }]; const run = T.newRun(c);
  const tq = tapper(6); runFor(run, 2, tq); const t1 = run.buffs.meat; const tr = tapper(3); runFor(run, 4.4, tr); const t2 = run.buffs.meat;
  check('BF-08', '肉の再取得は残り時間を10秒へ戻す', t2 <= 10 && t2 > t1 - 4.4 + 1.5, `${t1.toFixed(2)} → ${t2.toFixed(2)}`);
  const c2 = flat(); c2.pickups = [{ type: 'meat', z: 2.3, x: 0, y: 1 }]; const run2 = T.newRun(c2); runFor(run2, 1.5, tapper(3));
  check('BF-09', '肉: 連打効率×2（3打/秒で u≈1）', run2.buffs.meat > 0 && run2.u > 0.9, `u=${run2.u.toFixed(2)}`); }
{ const c = flat(); c.segs = [{ z0: -40, z1: 40, y: 0, hw: 3.5, type: 'rock' }, { z0: 43.4, z1: 3046, y: 0, hw: 3.5, type: 'rock' }]; c.pickups = [{ type: 'wig', z: 10, x: 0, y: 1, style: 'afro' }];
  const run = T.newRun(c); const tk = tapper(6); const r = runFor(run, 8, (t) => t < 1.5 ? tk() : NONE());
  check('KT-01', 'カツラ中は穴を自動ジャンプ', !r && run.p.z > 50, `z=${run.p.z.toFixed(1)} result=${r}`); }
{ const c = flat(); c.segs = [{ z0: -40, z1: 40, y: 0, hw: 3.5, type: 'rock' }, { z0: 60, z1: 3046, y: 0, hw: 3.5, type: 'rock' }];
  const run = T.newRun(c); runFor(run, 0.5, NONE); run.p.z = 30; run.p.vz = 8; run.buffs.wig = 1.45;
  const r = runFor(run, 3, NONE);
  check('KT-02', 'カツラ終了が落下中なら、先に救済してから終了', !r && run.stats.rescues >= 1 && run.p.y === 0, `rescues=${run.stats.rescues} result=${r}`); }
{ const c = flat(); c.segs = [{ z0: -40, z1: 40, y: 0, hw: 3.5, type: 'rock' }, { z0: 60, z1: 3046, y: 0, hw: 3.5, type: 'rock' }]; c.pickups = [{ type: 'shoes', z: 10, x: 0, y: 1 }];
  const run = T.newRun(c); const tk3 = tapper(6); const r = runFor(run, 14, () => run.stats.taps < 12 ? tk3() : NONE());
  check('KT-03', '靴は穴から救済しない', r === 'fall', `result=${r}`); }
{ const c = flat(); c.obstacles = [{ kind: 'boulder', z: 30, x: 0, w: 7, d: 1.6, h: 2.2, y: 0 }]; c.pickups = [{ type: 'wig', z: 10, x: 0, y: 1, style: 'afro' }];
  const run = T.newRun(c); const tk4 = tapper(6); while (run.buffs.wig <= 0 && run.t < 10) { T.simStep(run, tk4(), STEP); run.events.length = 0; } const f0 = run.flame; runFor(run, 5, NONE);
  check('KT-04', 'カツラ中は障害物無効・炎減少停止・STAMINA100', run.p.z > 40 && run.stats.hits === 0 && run.flame === f0 && run.stamina === 100, `z=${run.p.z.toFixed(1)}`); }
{ const run = T.newRun(flat()); runFor(run, 10, NONE); check('FI-01', '自然減少 1.4/秒', Math.abs(run.flame - 86) < 0.05, `${run.flame.toFixed(2)}`); }
{ const c = flat(); c.obstacles = [{ kind: 'boulder', z: 20, x: 0, w: 7, d: 1.6, h: 2.2, y: 0 }]; const run = T.newRun(c);
  const r = runFor(run, 5, tapper(6)); check('FI-02', '衝突 −18、0.8秒の再受付待ち', run.stats.hits >= 2 && run.stats.hits <= 6 && !r, `hits=${run.stats.hits}`); }
{ const c = flat(); c.hazards = [{ kind: 'water', z0: 20, z1: 21.6, x0: -3.7, x1: 3.7, y: 0 }]; const run = T.newRun(c); runFor(run, 5, tapper(6));
  check('FI-03', '水 −30（通過1回）', run.stats.water === 1, `water=${run.stats.water}`); }
{ const c = flat(); c.hazards = [{ kind: 'wind', z0: 0, z1: 3000 }]; const run = T.newRun(c); runFor(run, 5, NONE);
  check('FI-04', '風エリア +4/秒', Math.abs(run.flame - 73) < 0.1, `${run.flame.toFixed(2)}`); }
{ const run = T.newRun(flat()); run.flame = 0.5; const r = runFor(run, 1, NONE); check('FI-05', '聖火0で失敗', r === 'flame', `result=${r}`); }
{ const c = flat(); c.L = 30; const run = T.newRun(c); run.p.z = 29.95; run.p.vz = 8; run.flame = 0.01; run.p.prevZ = 29.95;
  T.simStep(run, NONE(), STEP); check('FI-06', 'ゴールと消失が同一フレーム → クリア', run.result === 'clear', `result=${run.result}`); }
{ const c = flat(); c.L = 30; const run = T.newRun(c); run.p.z = 29.0; run.p.vz = 8; run.flame = 0.01;
  T.simStep(run, NONE(), STEP); check('FI-07', 'ゴール手前で炎0 → 失敗', run.result === 'flame', `result=${run.result}`); }
{ const c = T.generateCourse(2400, false); const run = T.newRun(c); run.cp = 2; run.stats.deaths = 3; run.stats.taps = 500; run.buffs.wig = 5; run.p.vz = 6; run.flame = 2; run.stamina = 4;
  T.resetForRetry(run);
  check('RT-01', 'リトライ: 値の初期化とCP再開、死亡数と打数は累積', run.flame === 100 && run.stamina === 100 && run.p.vz === 0 && run.buffs.wig === 0 && Math.abs(run.p.z - 802) < 1e-6 && run.stats.deaths === 3 && run.stats.taps === 500, `z=${run.p.z}`); }
{ const L = 2400; let zero = false, prev = -Infinity, mono = true;
  for (let z = 0; z <= L; z += 0.5) { const y = T.eraYearAt(z, L); if (T.yearText(y).match(/(^|[^0-9])0年/)) zero = true; if (y < prev) mono = false; prev = y; }
  check('ER-01', '年0を表示しない・年は単調増加', !zero && mono, '');
  check('ER-02', '残り年数の計算', T.yearRemain(-9999) === 12025 && T.yearRemain(0) === 2026 && T.yearRemain(1987) === 39 && T.yearText(-9999) === '紀元前10,000年' && T.yearText(0) === '紀元前1年' && T.yearText(1) === '西暦1年', '');
  check('ER-03', '原始時代のゴールは BC3000', T.eraYearAt(L, L) === -2999 && T.yearText(-2999) === '紀元前3,000年', ''); }
for (const short of [false, true]) {
  const c = T.generateCourse(short ? 600 : 2400, short); c.pickups = c.pickups.filter(p => p.type === 'ember');
  const run = T.newRun(c); const bot = T.makeBot({ rate: 6 }); let r = null, maxV = 0;
  for (let i = 0; i < 60 * 1200; i++) { run.stamina = 0; run.flame = 100; T.simStep(run, T.botInput(run, bot, STEP), STEP); run.events.length = 0; maxV = Math.max(maxV, run.p.vz); if (run.result) { r = run.result; break; } }
  check('CR-0' + (short ? 2 : 1), `最低速度（${(C.move.maxSpeed * C.fatigue.base).toFixed(1)} m/s）で全ての穴・段差・丸太を越えて完走 ${short ? '600m' : '2400m'}`, r === 'clear', `result=${r} 最高速=${maxV.toFixed(2)}`);
}
{ const r = T.simulate({ policy: { rate: 6, rest: true } }); check('CR-03', '実コースで靴終了・カツラ終了を各3回以上、失敗なしで通過', r.clear && r.shoesEnds >= 3 && r.wigEnds >= 3 && r.deaths.length === 0, `shoesEnds=${r.shoesEnds} wigEnds=${r.wigEnds}`); }
{ const c = flat(); const run = T.newRun(c); run.p.z = 495; run.p.prevZ = 495; run.stamina = 20; const tk = tapper(6); let evs = [];
  while (run.cp < 1 && run.t < 5) { T.simStep(run, tk(), STEP); evs = evs.concat(run.events); run.events.length = 0; }
  const cpEv = evs.find(e => e.type === 'checkpoint');
  check('GT-01', '焚き火ゲート通過で STAMINA 全回復・区間タイムを通知', cpEv && run.stamina >= 99 && run.buffs.rest === 0 && cpEv.split > 0, `stamina=${run.stamina.toFixed(0)}`); }
{ const c = flat(); c.segs = [{ z0: -40, z1: 40, y: 0, hw: 3.5, type: 'rock' }, { z0: 43, z1: 3046, y: 0, hw: 3.5, type: 'rock' }];
  const go = (miss) => { const run = T.newRun(c); const bot = T.makeBot({ rate: 6, missRate: miss, collect: false }); for (let i = 0; i < 60 * 12; i++) { T.simStep(run, T.botInput(run, bot, STEP), STEP); run.events.length = 0; if (run.result) return run.result; } return run.p.z > 50 ? 'past' : 'stuck'; };
  const a = go(1), b = go(0);
  check('NP-01', 'NPCのミス判定（1は落下、0は越える）', a === 'fall' && b === 'past', `miss=1:${a} miss=0:${b}`); }

let pass = 0; for (const x of results) { if (x.ok) pass++; else console.log('FAIL  ' + x.id + '  ' + x.name + '  [' + x.detail + ']'); }
console.log(`${pass}/${results.length} passed`);
