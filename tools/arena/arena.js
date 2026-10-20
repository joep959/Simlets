// Predator arena: a controlled test fixture for carnivore founders.
//   node arena.js grow <repo> <seed> <out.json> [ticks]   grow a world (events + immigration off), strip its carnivores, snapshot it
//   node arena.js run  <repo> '<jobJSON>'                 load a snapshot, drop K designed carnivores, run, print one JSON line
// job: { snap, seed, genome: [28 numbers], place: 'in'|'edge'|'far', K, ticks, brain: 'zero' }
// Measures the founder lineage (founders + all descendants) stage by stage: encounter, capture, energy, breeding.
const fs = require('fs'), vm = require('vm'), path = require('path');
const cmd = process.argv[2], repo = path.resolve(process.argv[3]);
let src = require(path.join(repo, 'tools', 'simfiles.js'))(path.join(repo, 'js')).map(f => fs.readFileSync(f, 'utf8')).join('\n');
src += '\n' + fs.readFileSync(path.join(repo, 'js', 'save.js'), 'utf8');
const inj = (a, b, before) => { if (!src.includes(a)) throw new Error('hook not found: ' + a); src = src.replace(a, before ? b + a : a + b); };
inj('s.scores = sc;', ' __think(s, best, prey);');
inj('  s.attackCd = ATTACK_COOLDOWN;', '  __atk(s, o);\n', true);
inj("sim.kill(o, 'killed'); s.kills++;", ' __kill(s, o);');
inj('  s.energy = Math.min(s.maxEnergy, s.energy + amt * eff);', '\n  __bite(s, f, amt, eff);');
{ const a = 'Food.add({ x: s.x, y: s.y, e, e0: e, born: this.tick, ready: this.tick, type: 2 });';
  if (!src.includes(a)) throw new Error('hook not found: corpse');
  src = src.replace(a, 'const __f = { x: s.x, y: s.y, e, e0: e, born: this.tick, ready: this.tick, type: 2 }; Food.add(__f); __corpse(s, __f);'); }
// rule overrides for 'run' jobs: meatX scales every corpse's energy (breaks conservation; a sensitivity test),
// restX scales a carnivore's resting drain
const J0 = cmd === 'run' ? JSON.parse(process.argv[4]) : {};
const rep = (a, b) => { if (!src.includes(a)) throw new Error('override target not found: ' + a); src = src.replace(a, b); };
rep('const e = P.bodyCost * s.mass * 0.9 + Math.max(0, s.energy) * 0.8;', `const e = (P.bodyCost * s.mass * ${J0.corpseBody || 0.9} + Math.max(0, s.energy) * ${J0.corpseStore || 0.8}) * ${J0.meatX || 1};`);
// conserving levers: carnivore stomach (max energy) multiplier, corpse rot time
rep('this.maxEnergy = 40 * this.mass;', `this.maxEnergy = 40 * this.mass * (this.g[G.diet] > 0.66 ? ${J0.tankX || 1} : 1);`);
rep('const CORPSE_ROT = 1500;', `const CORPSE_ROT = ${J0.rot || 1500};`);
// Joe's stomach: carnivores eat into a stomach (capacity stomachX x tank), which digests into energy at a full
// tank per DIGEST ticks; a full stomach slows them (up to LETH); stomach contents go into the corpse
if (J0.stomachX) {
  const SX = J0.stomachX, DIG = J0.digest || 200, LETH = J0.leth == null ? 0.4 : J0.leth;
  rep('Math.max(0, s.energy) * ', 'Math.max(0, s.energy + (s.stomach || 0)) * ');
  rep('  const ms = s.maxSpeed;', `  const ms = s.maxSpeed * (s.stomachCap ? 1 - ${LETH} * s.stomach / s.stomachCap : 1);`);
  rep('function act(s, sim) {', `function act(s, sim) {
  if (s.g[G.diet] > 0.66) {
    if (s.stomachCap == null) { s.stomachCap = ${SX} * s.maxEnergy; s.stomach = 0; }
    if (s.stomach > 0) { const d = Math.min(s.stomach, s.maxEnergy / ${DIG}, s.maxEnergy - s.energy); if (d > 0) { s.energy += d; s.stomach -= d; } }
  }`);
  rep('  const amt = Math.min(f.e, f.type === 2 ? MEAT_BITE : P.plantBite);', `  if (s.stomachCap) {                           // carnivore with a stomach: food goes in, energy comes from digestion
    const eff0 = f.type === 2 ? s.meatEff : s.plantEff, room = s.stomachCap - s.stomach;
    if (room <= 0.01 || eff0 <= 0) { s.needThink = true; return; }
    const take = Math.min(f.e, f.type === 2 ? MEAT_BITE : P.plantBite, room / eff0);
    f.e -= take; s.stomach += take * eff0; __bite(s, f, take, eff0);
    if (f.e <= 0.01) { Food.remove(f); s.needThink = true; }
    return;
  }
  const amt = Math.min(f.e, f.type === 2 ? MEAT_BITE : P.plantBite);`);
}
rep("s.action === 'rest' || s.action === 'farm' || s.working ? 0.4 : 1)", `s.action === 'rest' ? (s.g[G.diet] > 0.66 ? 0.4 * ${J0.restX || 1} : 0.4) : s.action === 'farm' || s.working ? 0.4 : 1)`);
// breeding diagnostics + gestation prototype hooks; concX scales a carnivore's breeding (conception) threshold
rep('this.breedAt = 0.35 + 0.6 * g[G.breedThreshold];', `this.breedAt = (0.35 + 0.6 * g[G.breedThreshold]) * (g[G.diet] > 0.66 ? ${J0.concX || 1} : 1);`);
inj('  breed(a, b) {', '\n    if (__breedStart(a, b)) return;');
inj('    this.births += born;', ' __breedEnd(a, b, born);');
inj('  onDeath(s) {', ' __death(s);');
inj('function act(s, sim) {', '\n  __act(s);');
// upkeep split: movement cost by action (sprint marked *), idle drain split into base (rest / active / indoors) and winter cold
rep('  s.energy -= P.moveCost * s.mass * ref * ref * (inWater ? P.waterCost : 1);', '  { const __c = P.moveCost * s.mass * ref * ref * (inWater ? P.waterCost : 1); s.energy -= __c; __mv(s, __c); }');
inj('  s.energy -= P.idleCost * s.drainMult', '  const __e1 = s.energy;\n', true);
inj('  // camouflage: breaks with movement', '  __idle(s, __e1 - s.energy, cold, inside);\n', true);
const seedArg = cmd === 'grow' ? +process.argv[4] : JSON.parse(process.argv[4]).seed;
let st = seedArg >>> 0;
const rand = () => { st = (st + 0x6D2B79F5) >>> 0; let t = st; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const M = Object.create(Math); M.random = rand;
const ctx = vm.createContext({ console, Math: M, performance });
const noop = () => {}; Object.assign(ctx, { __think: noop, __atk: noop, __kill: noop, __bite: noop, __corpse: noop,
  __breedStart: () => false, __breedEnd: noop, __death: noop, __act: noop, __mv: noop, __idle: noop });
vm.runInContext(src + '\nObject.assign(this,{Sim,World,P,G,Food,Save,Species,Simlet,similarity,mutateGenome,newBrain,TERRAIN,MATURE_AGE,GENES,WORLD_W,WORLD_H});', ctx);
const { Sim, World, P, G, Save } = ctx;
const isCarn = s => s.g[G.diet] > 0.66;

if (cmd === 'grow') {
  const out = process.argv[5], T = +(process.argv[6] || 12000);
  Object.assign(P, { eventsOn: 0, immigration: 0 });
  World.generate(); Sim.seed();
  for (let i = 0; i < T; i++) Sim.step();
  const before = Sim.simlets.length;
  for (const s of Sim.simlets) if (isCarn(s)) s.dead = true;          // strip native carnivores (no corpses: just remove)
  Sim.simlets = Sim.simlets.filter(s => !s.dead);
  fs.writeFileSync(out, JSON.stringify(Save.serialize()));
  const d = Sim.simlets.map(s => s.g[G.diet]);
  console.log(JSON.stringify({ seed: seedArg, tick: Sim.tick, pop: before, kept: Sim.simlets.length, herb: d.filter(x => x < 0.33).length, omni: d.filter(x => x >= 0.33).length }));
  process.exit(0);
}

// ---- run ----
const job = JSON.parse(process.argv[4]);
Save.restore(JSON.parse(fs.readFileSync(job.snap, 'utf8')));
Object.assign(P, { eventsOn: 0, immigration: 0 }, job.params || {});
const K = job.K || 10, T = job.ticks || 6000, t0 = Sim.tick;
// herd centre: the plant-eater with most plant-eater neighbours within 8 tiles (sampled)
const prey = Sim.simlets.filter(s => s.g[G.diet] < 0.66);
let hub = prey[0], best = -1;
for (let k = 0; k < 60; k++) { const c = prey[(rand() * prey.length) | 0]; let n = 0; for (const o of prey) if (Math.hypot(o.x - c.x, o.y - c.y) < 8) n++; if (n > best) { best = n; hub = c; } }
const land = (x, y) => x > 2 && y > 2 && x < ctx.WORLD_W - 2 && y < ctx.WORLD_H - 2 && World.at(x, y) !== ctx.TERRAIN.WATER;
let cx = hub.x, cy = hub.y;
if (job.place !== 'in') {
  const R = job.place === 'edge' ? 12 : 30;
  for (let k = 0; k < 200; k++) { const a = rand() * 2 * Math.PI, x = hub.x + Math.cos(a) * R, y = hub.y + Math.sin(a) * R; if (land(x, y)) { cx = x; cy = y; break; } }
}
const lineage = new Set(), founderIds = new Set();
const sp = ctx.Species.create(job.genome, null, Sim.tick);
for (let i = 0; i < K; i++) {
  const g = ctx.mutateGenome(Float32Array.from(job.genome), 0.5, 0.05);
  let x = cx, y = cy;
  for (let k = 0; k < 20; k++) { const nx = cx + (rand() - 0.5) * 6, ny = cy + (rand() - 0.5) * 6; if (land(nx, ny)) { x = nx; y = ny; break; } }
  const s = new ctx.Simlet(g, x, y, 1e9, 0, []);
  s.energy = s.maxEnergy / (job.tankX || 1) * P.founderEnergy;   // same starting energy whatever the stomach size
  s.age = (rand() * ctx.MATURE_AGE * 2) | 0;
  s.origin = 'founder'; s.species = sp; s.brain = ctx.newBrain();     // zero brain = pure rules behaviour
  Sim.simlets.push(s); lineage.add(s.id); founderIds.add(s.id);
}
const R = { thinks: 0, realPrey: 0, kinPrey: 0, hunt: 0, acts: {}, attacks: 0, kills: 0, kinKills: 0, meatE: 0, plantE: 0, births: 0, founderKids: 0,
  deaths: {}, peak: K, carnTicks: 0, adultsBorn: 0, atkE: 0, corpseE: 0, eatSelf: 0, eatHerb: 0, eatOmni: 0, eatCarnOther: 0, killMass: 0 };
const inL = s => lineage.has(s.id);
ctx.__think = (s, best, p) => {
  if (!inL(s)) return;
  R.thinks++; R.acts[best] = (R.acts[best] || 0) + 1;
  if (p) { if (ctx.similarity(s.g, p.g) > 0.6) R.kinPrey++; else if (p.g[G.diet] < 0.66) R.realPrey++; }
};
ctx.__atk = (s, o) => { if (inL(s)) { R.attacks++; R.atkE += P.attackCost * Math.pow(s.mass, 0.75); } };
ctx.__kill = (s, o) => { if (inL(s)) { R.kills++; R.killMass += o.mass; o.__byLin = true; if (inL(o)) R.kinKills++; } };
ctx.__corpse = (s, f) => { if (s.__byLin) { f.lin = true; R.corpseE += f.e; } };
ctx.__bite = (s, f, amt, eff) => {
  if (inL(s)) { if (f.type === 2) R.meatE += amt * eff; else R.plantE += amt * eff; }
  if (f.lin) { if (inL(s)) R.eatSelf += amt; else { const d = s.g[G.diet]; if (d < 0.33) R.eatHerb += amt; else if (d <= 0.66) R.eatOmni += amt; else R.eatCarnOther += amt; } }
};
// ---- breeding diagnostics, and the gestation prototype (job.gest = gestation ticks; carnivores in the lineage only) ----
// Gestation: breeding starts a pregnancy instead of an instant litter. Each tick the parent moves energy into the litter
// (never dropping below 30% of its tank); each baby needs body cost + 30% of a tank. Birth when the litter is fully
// stocked, or at 2 x gestation with as many babies as the pool covers (none: the pool goes back to the parent).
// A parent dying while pregnant takes the pool into its corpse (energy is conserved).
const GEST = job.gest || 0;
Object.assign(R, { conceptions: 0, litters: 0, stillborn: 0, breedSpent: 0, kidsStart: 0, deadStore: 0, founderStart: 0,
  parentDeathAfterBreed: 0, eligTicks: 0, adultTicks: 0, gestAborted: 0, gestLost: 0, matured: 0 });
const lastBred = new Map(), maturedIds = new Set();
let sb0 = 0, e0 = 0;
const target = s => s.mass * (P.bodyCost + 0.3 * 40);                  // energy per baby (child ~ parent size)
ctx.__breedStart = (a, b) => {
  if (!inL(a)) return false;
  sb0 = Sim.stillborn; e0 = a.energy + (b && inL(b) ? b.energy : 0);
  if (!GEST || a.__birthing || !isCarn(a)) return false;
  a.gest = { t0: Sim.tick, pool: 0, need: a.brood * target(a) }; R.conceptions++;
  a.breedCd = 1e9; a.breedMode = null; a.needThink = true;              // not ready again while pregnant
  if (b) { b.breedCd = 400; b.breedMode = null; b.needThink = true; }
  return true;
};
ctx.__breedEnd = (a, b, born) => {
  if (!inL(a)) return;
  R.litters++; R.stillborn += Sim.stillborn - sb0; lastBred.set(a.id, Sim.tick);
  if (!a.__birthing) R.breedSpent += e0 - (a.energy + (b && inL(b) ? b.energy : 0));
};
ctx.__act = s => {
  const g = s.gest; if (!g) return;
  const d = Math.min(g.need / GEST, s.energy - 0.3 * s.maxEnergy, g.need - g.pool);
  if (d > 0) { s.energy -= d; g.pool += d; }
  if (g.pool < g.need - 1e-6 && Sim.tick - g.t0 < 2 * GEST) return;
  s.gest = null;
  const per = target(s), n = Math.floor(g.pool / per);
  if (n < 1) { s.energy = Math.min(s.maxEnergy, s.energy + g.pool); s.breedCd = 400; R.gestAborted++; return; }
  const E = s.energy, brood = s.brood, ov = P.breedCost * Math.pow(s.mass, 0.75), c0 = s.children;
  s.__birthing = true; s.brood = n; s.energy = 2 * n * per;              // Sim.breed gives the litter half of this = n * per
  Sim.breed(s, null);
  s.__birthing = false; s.brood = brood;
  if (s.children > c0) { s.energy = Math.max(0, E - 1.5 * ov); R.breedSpent += n * per + 1.5 * ov; s.energy = Math.min(s.maxEnergy, s.energy + (g.pool - n * per)); }
  else { s.energy = Math.min(s.maxEnergy, E + g.pool); s.breedCd = 400; R.gestAborted++; }   // population cap: nothing born
};
ctx.__death = s => {
  if (!inL(s)) return;
  if (s.gest) { s.energy += s.gest.pool; s.gest = null; R.gestLost++; }
  R.deadStore += s.energy + (s.stomach || 0);
  if (lastBred.has(s.id) && Sim.tick - lastBred.get(s.id) < 500) R.parentDeathAfterBreed++;
};
const U = { move: {}, ticks: {}, idleRest: 0, idleActive: 0, idleInside: 0, cold: 0 };
ctx.__mv = (s, c) => { if (!inL(s)) return; const k = s.action + (s.sprinting ? '*' : ''); U.move[k] = (U.move[k] || 0) + c; U.ticks[k] = (U.ticks[k] || 0) + 1; };
ctx.__idle = (s, c, cold, inside) => {
  if (!inL(s)) return;
  const base = c / (1 + cold); U.cold += c - base;
  if (inside) U.idleInside += base; else if (s.action === 'rest') U.idleRest += base; else U.idleActive += base;
};
for (const s of Sim.simlets) if (inL(s)) R.founderStart += s.energy;
let maxId = 0; for (const s of Sim.simlets) maxId = Math.max(maxId, s.id);
const dead = new Set();
let extinctAt = null;
for (let i = 0; i < T; i++) {
  const before = new Set(Sim.simlets.filter(inL));
  Sim.step();
  for (const s of Sim.simlets) if (s.id > maxId) {
    maxId = Math.max(maxId, s.id);
    if (s.parents.some(p => lineage.has(p))) { lineage.add(s.id); R.births++; R.kidsStart += s.energy; if (s.parents.some(p => founderIds.has(p))) R.founderKids++; }
  }
  for (const s of Sim.simlets) if (inL(s) && !s.dead) {
    if (s.age >= s.matureAge) { R.adultTicks++; if (s.energy / s.maxEnergy >= s.breedAt) R.eligTicks++; if (!founderIds.has(s.id) && !maturedIds.has(s.id)) { maturedIds.add(s.id); R.matured++; } }
  }
  for (const s of before) if (s.dead && !dead.has(s.id)) { dead.add(s.id); R.deaths[s.cause] = (R.deaths[s.cause] || 0) + 1; }
  const alive = Sim.simlets.filter(inL);
  R.carnTicks += alive.length; if (alive.length > R.peak) R.peak = alive.length;
  if (!alive.length) { extinctAt = i + 1; break; }
}
const alive = Sim.simlets.filter(inL);
console.log(JSON.stringify({ id: job.id, arm: job.arm, snap: path.basename(job.snap), place: job.place, genome: job.genome, K, T,
  aliveEnd: alive.length, extinctAt, peak: R.peak, births: R.births, founderKids: R.founderKids, carnTicks: R.carnTicks,
  thinks: R.thinks, realPrey: R.realPrey, kinPrey: R.kinPrey, acts: R.acts, attacks: R.attacks, kills: R.kills, kinKills: R.kinKills,
  meatE: +R.meatE.toFixed(1), atkE: +R.atkE.toFixed(1), corpseE: +R.corpseE.toFixed(1), eatSelf: +R.eatSelf.toFixed(1), eatHerb: +R.eatHerb.toFixed(1), eatOmni: +R.eatOmni.toFixed(1), eatCarnOther: +R.eatCarnOther.toFixed(1), meanKillMass: R.kills ? +(R.killMass / R.kills).toFixed(2) : null, plantE: +R.plantE.toFixed(1), deaths: R.deaths,
  meanDietEnd: alive.length ? +(alive.reduce((a, s) => a + s.g[G.diet], 0) / alive.length).toFixed(3) : null,
  // breeding diagnostics and energy ledger (lineage totals; upkeep = everything not otherwise accounted for)
  upkeepSplit: { move: Object.fromEntries(Object.entries(U.move).map(([k, v]) => [k, +v.toFixed(1)])), ticks: U.ticks,
    idleRest: +U.idleRest.toFixed(1), idleActive: +U.idleActive.toFixed(1), idleInside: +U.idleInside.toFixed(1), cold: +U.cold.toFixed(1) },
  conceptions: R.conceptions, litters: R.litters, stillborn: R.stillborn, gestAborted: R.gestAborted, gestLost: R.gestLost, matured: R.matured,
  parentDeathAfterBreed: R.parentDeathAfterBreed, eligShare: R.adultTicks ? +(R.eligTicks / R.adultTicks).toFixed(3) : null,
  ledger: (() => { const stock = alive.reduce((a, s) => a + s.energy + (s.stomach || 0) + (s.gest ? s.gest.pool : 0), 0);
    const intake = R.meatE + R.plantE, up = R.founderStart + intake + R.kidsStart - R.atkE - R.breedSpent - R.deadStore - stock;
    return { start: +R.founderStart.toFixed(0), intake: +intake.toFixed(0), attacks: +R.atkE.toFixed(0), breeding: +R.breedSpent.toFixed(0), kidsStart: +R.kidsStart.toFixed(0), upkeep: +up.toFixed(0), deadStore: +R.deadStore.toFixed(0), stockEnd: +stock.toFixed(0) }; })() }));
