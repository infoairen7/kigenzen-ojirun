// Every era's course can be cleared by the test bot (standard and short), and later eras are a bit harder.
const fs = require('fs');
const html = fs.readFileSync(process.argv[2], 'utf8');
const core = html.match(/<script id="torch-core">([\s\S]*?)<\/script>/)[1];
new Function(core)();
const T = globalThis.TorchCore;
let bad = 0;
for (let era = 0; era < 9; era++) {
  for (const short of [false, true]) {
    const c = T.generateCourse(short ? 600 : 2400, short, era);
    const gaps = []; for (let i = 0; i + 1 < c.segs.length; i++) if (c.segs[i + 1].z0 > c.segs[i].z1 + 0.01) gaps.push(+(c.segs[i + 1].z0 - c.segs[i].z1).toFixed(2));
    const runs = [];
    for (const policy of [{ rate: 6 }, { rate: 5.4, rest: true }, { rate: 6, missRate: 0 }]) runs.push(T.simulate({ era, short, policy, maxTime: 1500 }));
    const ok = runs.every(r => r.clear);
    if (!ok) bad++;
    const y0 = T.eraYearAt(0, c.L, era), y1 = T.eraYearAt(c.L, c.L, era);
    console.log(`era ${era + 1}${short ? ' short' : ''}: ${ok ? 'ok ' : 'BAD'} gaps ${gaps.length} max ${Math.max(0, ...gaps)} obs ${c.obstacles.length} bridges ${c.segs.filter(s => s.type === 'bridge').length} years ${y0}..${y1} times ${runs.map(r => r.time + 's/' + r.deaths.length + 'd').join(' ')}`);
  }
}
console.log('era sim:', bad ? bad + ' failing' : 'all clear');
