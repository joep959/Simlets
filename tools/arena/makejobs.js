// Build a paired arena job list: the same 8 carnivore designs x 4 worlds for every arm (setup).
//   node makejobs.js <snapDir> '<armsJSON>' <out.json> [perArm=8] [place=edge]
//   e.g. node makejobs.js snaps "{\"base\":{},\"fair\":{\"params\":{\"attackCost\":0.5},\"corpseBody\":1,\"corpseStore\":1,\"rot\":3000,\"restX\":0.3}}" jobs.json
// Arm options (see arena.js): params {slider: value}, meatX, corpseBody, corpseStore, rot, restX, tankX, stomachX, gest, concX.
// Designs are random carnivore genomes (diet 0.7-1, other genes uniform) from a fixed seed, the same set used since 19 Oct 2026.
const fs = require('fs'), path = require('path');
const [dir, armsJ, out] = process.argv.slice(2, 5), per = +(process.argv[5] || 8), place = process.argv[6] || 'edge';
let st = 12345; const r = () => { st = (st * 1103515245 + 12345) % 2147483648; return st / 2147483648; };
const designs = [];
for (let id = 0; id < per; id++) { const g = Array.from({ length: 28 }, () => +r().toFixed(3)); g[3] = +(0.7 + 0.3 * r()).toFixed(3); designs.push(g); }
const snaps = ['snap11.json', 'snap13.json', 'snap14.json', 'snap16.json'].map(s => path.resolve(dir, s));
const J = []; let id = 0;
for (const [arm, o] of Object.entries(JSON.parse(armsJ)))
  for (let k = 0; k < per; k++) J.push({ id: id++, arm, snap: snaps[k % 4], seed: 2000 + k, genome: designs[k], place, K: 10, ticks: 6000, ...o });
fs.writeFileSync(out, JSON.stringify(J)); console.log(J.length + ' jobs');
