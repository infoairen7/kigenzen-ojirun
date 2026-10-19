const fs = require('fs');
const html = fs.readFileSync(process.argv[2], 'utf8');
const m = html.match(/<script id="torch-core">([\s\S]*?)<\/script>/);
new Function(m[1])();
module.exports = globalThis.TorchCore;
if (require.main === module) {
  const T = module.exports;
  for (const short of [false, true]) {
    const c = T.generateCourse(short ? 600 : 2400, short);
    console.log(`== course ${short ? 'short 600' : 'standard 2400'}: segs=${c.segs.length} obstacles=${c.obstacles.length} pickups=${c.pickups.length}`);
    const P = { 'full 6/s': { rate: 6 }, 'rhythm': { rate: 6, rest: true, restBelow: 25, restFor: 1.6 }, 'slow 4/s': { rate: 4 }, 'drinks': { rate: 6, drink: true } };
    for (const [n, pol] of Object.entries(P)) { const r = T.simulate({ short, policy: pol }); console.log(`   ${n.padEnd(10)} clear=${r.clear} t=${r.time}s deaths=${r.deaths.length} minFlame=${r.minFlame}`); }
  }
}
