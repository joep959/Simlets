// Run the simulation without a browser, for balance testing.
//   node tools/headless.js [ticks] [paramOverridesJSON] [reportEvery]
//   e.g. node tools/headless.js 20000 "{\"immigration\":3000}" 2000
// Loads the same js/ files the page uses (minus rendering/UI) into one shared scope.
const fs = require('fs'), vm = require('vm'), path = require('path');
const dir = path.join(__dirname, '..', 'js');
const files = ['config', 'genome', 'species', 'world', 'simlet', 'sim'];
const src = files.map(f => fs.readFileSync(path.join(dir, f + '.js'), 'utf8')).join('\n');
const ctx = vm.createContext({ console, Math, performance });
vm.runInContext(src + '\nthis.Sim=Sim;this.World=World;this.Food=Food;this.Species=Species;this.P=P;this.G=G;', ctx);
const { Sim, World, Food, Species, P, G } = ctx;

const T = +(process.argv[2] || 20000);
Object.assign(P, JSON.parse(process.argv[3] || '{}'));
const every = +(process.argv[4] || 2000);

World.generate();
Sim.seed();
const t0 = Date.now();
for (let i = 1; i <= T; i++) {
  Sim.step();
  if (i % every === 0) {
    const L = Sim.simlets;
    const mean = k => (L.reduce((a, s) => a + s.g[G[k]], 0) / Math.max(1, L.length)).toFixed(2);
    const herb = L.filter(s => s.g[G.diet] < 0.33).length, carn = L.filter(s => s.g[G.diet] > 0.66).length;
    console.log(`t=${i} ${World.season(i) ? 'BUST' : 'BOOM'} pop=${L.length} H/O/C=${herb}/${L.length - herb - carn}/${carn} ` +
      `food=${Food.count} species=${Species.live.size} births sex/asex=${Sim.birthsSex}/${Sim.birthsAsex} ` +
      `deaths=${JSON.stringify(Sim.deaths)} mean size=${mean('size')} speed=${mean('speed')} diet=${mean('diet')} sex=${mean('sexuality')}`);
  }
  if (!Sim.simlets.length) { console.log('EXTINCT at tick', i); break; }
}
console.log('ticks/sec', (Sim.tick / ((Date.now() - t0) / 1000)).toFixed(0));
