// Land + population balance probe: like headless.js, plus land shares, churn and seeded maps.
//   node tools/landprobe.js <jsDir> <ticks> <paramsJSON> <reportEvery> <withSimlets 0|1> [CONST=value,...] [seed]
//   e.g. node tools/landprobe.js js 40000 "{\"plantSoil\":0.1}" 4000 1 "BROWSE=0.15" 11
// A seed (non-zero) makes Math.random reproducible, so different settings run on identical maps (paired tests).
// CONST overrides replace `const NAME = value` in the loaded source (for constants that aren't sliders).
const fs = require('fs'), vm = require('vm'), path = require('path');
const [dir, T, over, every, withS] = [process.argv[2], +process.argv[3], JSON.parse(process.argv[4] || '{}'), +process.argv[5], process.argv[6] !== '0'];
let src = ['config', 'genome', 'brain', 'species', 'world', 'shelter', 'simlet', 'sim', 'events', 'events/plague', 'events/fire', 'events/flood', 'events/famine', 'events/bounty', 'events/mutation'].map(f => fs.readFileSync(path.join(dir, f + '.js'), 'utf8')).join('\n');
for (const kv of (process.argv[7] || '').split(',').filter(Boolean)) { const [k, v] = kv.split('='); const re = new RegExp('const ' + k + ' = [^;,]+'); if (!re.test(src)) throw new Error('no const ' + k); src = src.replace(re, 'const ' + k + ' = ' + v); }
const seed = +(process.argv[8] || 0);
let st = seed >>> 0;
const rand = () => { st = (st + 0x6D2B79F5) >>> 0; let t = st; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const M = Object.create(Math); if (seed) M.random = rand;
const ctx = vm.createContext({ console, Math: M, performance });
vm.runInContext(src + '\nthis.Sim=Sim;this.World=World;this.P=P;this.Food=Food;this.TERRAIN=TERRAIN;this.Shelters=Shelters;this.G=G;', ctx);
const { Sim, World, P, Food, TERRAIN } = ctx;
Object.assign(P, over);
World.generate(); if (withS) Sim.seed(); else Sim.reset();
let prevT = Uint8Array.from(World.terrain), minPop = 1e9, minBust = 1e9;
const land = () => { const c = [0, 0, 0, 0]; for (const t of World.terrain) c[t]++; return c; };
const report = i => {
  const c = land(), L = c[0] + c[1] + c[2], L2 = Sim.simlets;
  let churn = 0; for (let k = 0; k < prevT.length; k++) if (prevT[k] !== World.terrain[k]) churn++;
  prevT = Uint8Array.from(World.terrain);
  let cx = 0, cy = 0; for (const s of L2) { cx += s.x; cy += s.y; } const n = Math.max(1, L2.length);
  let soil = 0; for (const ti of (World.landTiles || [])) soil += World.soil[ti];
  const carn = L2.filter(s => s.g[ctx.G.diet] > 0.66).length;
  console.log(`t=${i} ${World.season(i) ? 'BUST' : 'BOOM'} fert ${(c[1] / L * 100).toFixed(1)}% grass ${(c[0] / L * 100).toFixed(1)}% forest ${(c[2] / L * 100).toFixed(1)}% churn ${churn} soil ${(soil / L).toFixed(2)} dormant ${World.depleted.size} | pop ${L2.length} carn ${carn} food ${Food.count} centre ${(cx / n).toFixed(0)},${(cy / n).toFixed(0)} houses ${[...ctx.Shelters.tiles.values()].filter(s => s.done).length}`);
};
report(0);
const t0 = Date.now();
for (let i = 1; i <= T; i++) {
  Sim.step();
  if (withS) { minPop = Math.min(minPop, Sim.simlets.length); if (World.season(i)) minBust = Math.min(minBust, Sim.simlets.length); }
  if (i % every === 0) report(i);
  if (withS && !Sim.simlets.length) { console.log('EXTINCT at', i); break; }
}
console.log(`done: min pop ${minPop}, min bust pop ${minBust}, ticks/sec ${(Sim.tick / ((Date.now() - t0) / 1000)).toFixed(0)}`);
