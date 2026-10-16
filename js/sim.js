'use strict';
// The simulation clock: one step() = one tick of the world.

const SIM_CELL = 10;
const Sim = {
  tick: 0,
  simlets: [],
  newborns: [],
  gw: Math.ceil(WORLD_W / SIM_CELL), gh: Math.ceil(WORLD_H / SIM_CELL),
  grid: null,
  births: 0, deaths: { starved: 0, old: 0, killed: 0 }, alarms: 0, farmEvents: 0, stillborn: 0, arrivals: 0, lastImmigration: 0, dropFx: [], birthsSex: 0, birthsAsex: 0, brainCorr: 0, brainThinks: 0, brainInfluence: 0,
  history: null,

  reset() {
    this.tick = 0; this.simlets = []; this.newborns = [];
    this.births = 0; this.deaths = { starved: 0, old: 0, killed: 0 }; this.alarms = 0; this.farmEvents = 0; this.stillborn = 0;
    this.arrivals = 0; this.lastImmigration = 0; this.dropFx = []; this.birthsSex = 0; this.birthsAsex = 0; this.brainCorr = 0; this.brainThinks = 0; this.brainInfluence = 0;
    this.history = { interval: 50, t: [], pop: [], herb: [], omni: [], carn: [], food: [], mean: [], sd: [], species: [] };
    Species.reset();
    World.tilled.clear();
    World.resetSoil();
    World.ice.fill(0); World.iceTiles = [];
    World.scent.fill(0);
    Shelters.reset();
    this.grid = Array.from({ length: this.gw * this.gh }, () => []);
    Food.reset();
  },

  // Each tribe = one random founder genome + small variations, dropped together on land
  seed() {
    this.reset();
    // founders land within a region covering seedSpread of the map (1 = anywhere), so tribes share a landscape
    const hw = (WORLD_W - 20) * P.seedSpread / 2, hh = (WORLD_H - 20) * P.seedSpread / 2;
    const ox = 10 + hw + Math.random() * (WORLD_W - 20 - 2 * hw), oy = 10 + hh + Math.random() * (WORLD_H - 20 - 2 * hh);
    for (let t = 0; t < P.tribes; t++) { const [cx, cy] = this.randomLand(ox, oy, hw, hh); this.dropTribe(cx, cy, 'founder'); }
    Species.update(this.simlets, 0);
    // a little starting food
    for (let i = 0; i < 400; i++) this.spawnOn(World.fertileTiles, 1 / Math.max(1, World.fertileTiles.length));
    this.sample();
  },

  // random dry land, anywhere by default or within ±hw/±hh of (ox, oy)
  randomLand(ox = WORLD_W / 2, oy = WORLD_H / 2, hw = WORLD_W / 2 - 10, hh = WORLD_H / 2 - 10) {
    let cx, cy, tries = 0;
    do { cx = ox + (Math.random() * 2 - 1) * hw; cy = oy + (Math.random() * 2 - 1) * hh; }
    while (World.at(cx, cy) === TERRAIN.WATER && ++tries < 200);
    return [clamp(cx, 5, WORLD_W - 5), clamp(cy, 5, WORLD_H - 5)];
  },

  // A tribe = one new random founder genome + small variations, dropped together around (cx, cy)
  dropTribe(cx, cy, origin) {
    const founder = randomGenome();
    let founderBrain = newBrain();
    // newcomers (air-drops, immigrants) borrow "local know-how": the brain of a living simlet with a similar diet
    if (origin !== 'founder' && this.simlets.length) {
      let donor = null, bd = 1e9;
      for (let k = 0; k < 40; k++) {
        const c = this.simlets[(Math.random() * this.simlets.length) | 0], dd = Math.abs(c.g[G.diet] - founder[G.diet]);
        if (c.brain && dd < bd) { bd = dd; donor = c; }
      }
      if (donor) founderBrain = new Float32Array(donor.brain);
    }
    // lean predator founders: a meat-eating founder has its upkeep genes nudged toward moderate values
    // (a random predator is often a big, long-lived, high-stamina body it can't afford to feed)
    if (P.leanPredators > 0 && founder[G.diet] > 0.66) {
      const k = P.leanPredators;
      for (const [gene, target] of [['size', 0.35], ['lifespan', 0.3], ['stamina', 0.45], ['memory', 0.3], ['smell', 0.5]])
        founder[G[gene]] += (target - founder[G[gene]]) * k;
    }
    const sp = Species.create(founder, null, this.tick);         // every new tribe starts its own species
    for (let i = 0; i < P.tribeSize; i++) {
      const g = mutateGenome(founder, 0.5, 0.05);
      const x = clamp(cx + gauss() * 4, 1, WORLD_W - 1), y = clamp(cy + gauss() * 4, 1, WORLD_H - 1);
      const s = new Simlet(g, x, y, 1e9, 0, []);
      s.energy = s.maxEnergy * P.founderEnergy;
      s.age = (Math.random() * MATURE_AGE * 2) | 0;
      s.origin = origin; s.species = sp;
      s.brain = new Float32Array(founderBrain);              // tribe shares the founder brain (zero output = rules only)
      this.simlets.push(s);
    }
    if (origin !== 'founder') { this.arrivals++; this.dropFx.push({ x: cx, y: cy, t: performance.now() }); }
  },

  buildGrid() {
    for (const c of this.grid) c.length = 0;
    for (const s of this.simlets) {
      const cx = clamp((s.x / SIM_CELL) | 0, 0, this.gw - 1), cy = clamp((s.y / SIM_CELL) | 0, 0, this.gh - 1);
      this.grid[cy * this.gw + cx].push(s);
    }
  },
  querySimlets(x, y, r, cb) {
    const x0 = Math.max(0, ((x - r) / SIM_CELL) | 0), x1 = Math.min(this.gw - 1, ((x + r) / SIM_CELL) | 0);
    const y0 = Math.max(0, ((y - r) / SIM_CELL) | 0), y1 = Math.min(this.gh - 1, ((y + r) / SIM_CELL) | 0);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      const arr = this.grid[cy * this.gw + cx];
      for (let i = 0; i < arr.length; i++) cb(arr[i]);
    }
  },

  step() {
    this.tick++;
    const mult = World.season(this.tick) === 0 ? 1 : P.bustFactor;
    this.spawnOn(World.fertileTiles, P.fertileSpawn / 1000 * mult);
    this.spawnOn(World.grassTiles, P.grassSpawn / 1000 * mult);
    this.spawnOn(World.forestTiles, P.forestSpawn / 1000);          // forest: low but steady, unaffected by bust
    if (this.tick % 25 === 0) { this.rotFood(); World.recoverSoil(25); World.fadeScent(25); }
    if (this.tick % 100 === 0) World.updateIce(this.tick);
    if (this.tick % 25 === 0) Shelters.update(this.tick);
    if (P.immigration > 0 && this.tick - this.lastImmigration >= P.immigration) {   // trickle of newcomers
      this.lastImmigration = this.tick;
      const [cx, cy] = this.randomLand();
      this.dropTribe(cx, cy, 'immigrant');
    }
    this.buildGrid();
    Shelters.countOccupants(this.simlets);

    const list = this.simlets;
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (s.dead) continue;
      s.age++;
      if (s.attackCd > 0) s.attackCd--;
      if (s.breedCd > 0) s.breedCd--;
      if (s.alarmCd > 0) s.alarmCd--;
      if (s.alarmTimer > 0) s.alarmTimer--;
      if (s.alarmFlash > 0) s.alarmFlash--;
      if (s.alertTimer > 0) s.alertTimer--;
      if (s.needThink || --s.thinkTimer <= 0) {
        s.needThink = false;
        think(s, this);
        s.thinkTimer = s.action === 'farm' ? 60 : s.action === 'rest' || s.inShelter ? 15 : s.working ? BUILD_SESSION : THINK_INTERVAL;
      }
      act(s, this);
      if (s.energy <= 0) this.kill(s, 'starved');
      else if (s.age > s.maxAge) this.kill(s, 'old');
    }

    let w = 0;
    for (let i = 0; i < list.length; i++) { const s = list[i]; if (s.dead) this.onDeath(s); else list[w++] = s; }
    list.length = w;
    for (const b of this.newborns) list.push(b);
    this.newborns.length = 0;

    if (this.tick % 50 === 0) Species.update(this.simlets, this.tick);
    if (this.brainThinks >= 2000) {             // rolling average size of the brain's score corrections
      this.brainInfluence = this.brainCorr / this.brainThinks; this.brainCorr = 0; this.brainThinks = 0;
    }
    if (this.tick % this.history.interval === 0) this.sample();
  },

  spawnOn(tiles, p) {
    if (!tiles.length) return;
    const exp = tiles.length * p;
    let n = Math.floor(exp); if (Math.random() < exp - n) n++;
    for (let k = 0; k < n; k++) {
      const ti = tiles[(Math.random() * tiles.length) | 0];
      if (Food.tileCount[ti] >= P.tileCap || World.soil[ti] < SOIL_MIN || Shelters.tiles.has(ti)) continue;   // dormant soil / shelters grow nothing
      Food.add({ x: ti % WORLD_W + Math.random(), y: ((ti / WORLD_W) | 0) + Math.random(),
                 e: P.plantEnergy, born: this.tick, ready: this.tick, type: 0 });
    }
  },

  rotFood() {
    const tick = this.tick, boom = World.season(tick) === 0;
    Food.forEach(f => {
      // decay feeds the soil: rotting corpses and food return nutrients to the tile they lie on
      if (f.type === 2) {
        const d = Math.min(f.e, f.e0 * 25 / CORPSE_ROT);
        f.e -= d; World.addNutrients(f.x, f.y, d * SOIL_PER_ENERGY);
        if (f.e <= 0.5) Food.remove(f);
      } else if (tick >= f.ready) {
        // plants age faster in the warm boom (boomRot ×), normally in bust; stored food in shelters never rots
        f.rot = (f.rot || 0) + 25 * (boom ? P.boomRot : 1);
        if (f.rot > P.rotTime * (f.type === 1 ? P.cropKeep : 1)) {                  // crops store better
          World.addNutrients(f.x, f.y, f.e * SOIL_PER_ENERGY); Food.remove(f);
        }
      }
    });
  },

  kill(s, cause) {
    if (s.dead) return;
    s.dead = true; s.cause = cause; s.diedAt = this.tick;
  },
  onDeath(s) {
    this.deaths[s.cause]++;
    const e = P.bodyCost * s.mass * 0.9 + Math.max(0, s.energy) * 0.8;
    Food.add({ x: s.x, y: s.y, e, e0: e, born: this.tick, ready: this.tick, type: 2 });
  },

  // b = mate for sexual breeding, or null for asexual (one parent pays everything, child is a mutated clone)
  breed(a, b) {
    if (this.simlets.length + this.newborns.length >= P.maxPop) { a.breedCd = 100; a.needThink = true; return; }
    const overhead = P.breedCost * Math.pow(a.mass, 0.75);
    const ca = a.energy * 0.5, cb = b ? b.energy * 0.3 : 0;
    a.energy -= ca + (b ? overhead : overhead * 1.5);
    if (b) b.energy -= cb + overhead * 0.5;
    // initiator's brood gene sets the max litter; litter shrinks if the energy can't build that many bodies
    const n = Math.max(1, Math.min(a.brood, Math.floor((ca + cb) / (P.bodyCost * a.mass * 1.6))));
    const each = (ca + cb) / n;
    let born = 0;
    for (let k = 0; k < n; k++) {
      const g = mutateGenome(b ? crossover(a.g, b.g) : a.g, P.mutationRate, P.mutationSize);
      const c = new Simlet(g, clamp(a.x + gauss() * 0.8, 0.5, WORLD_W - 0.5), clamp(a.y + gauss() * 0.8, 0.5, WORLD_H - 0.5),
                           0, (b ? Math.max(a.gen, b.gen) : a.gen) + 1, b ? [a.id, b.id] : [a.id]);
      // building the body costs energy; if the share can't cover body + a little reserve, the child isn't viable
      const left = each - P.bodyCost * c.mass;
      if (left < c.maxEnergy * 0.1) { this.stillborn++; continue; }
      c.energy = Math.min(left, c.maxEnergy);
      c.species = a.species; Species.assign(c, this.tick);
      if (a.field) c.field = { ...a.field };
      c.home = a.home;                                        // born into the family home
      const cb = b ? crossBrains(a.brain, b.brain) : new Float32Array(a.brain);
      c.brain = Brain.mode === 'hybrid' ? mutateBrain(cb, P.mutationRate, P.brainMutSize) : cb;   // brains only evolve while in use                   // children grow up knowing the family field       // usually the parent's species; a misfit founds a new one
      this.newborns.push(c); born++;
    }
    a.breedCd = BREED_COOLDOWN; a.children += born; a.needThink = true; a.breedMode = null;
    if (b) { b.breedCd = BREED_COOLDOWN; b.children += born; b.needThink = true; b.breedMode = null; this.birthsSex += born; }
    else this.birthsAsex += born;
    this.births += born;
  },

  sample() {
    const h = this.history, L = this.simlets;
    let herb = 0, omni = 0, carn = 0;
    const sum = new Float64Array(NG), sq = new Float64Array(NG);
    for (const s of L) {
      const d = s.g[G.diet];
      if (d < 0.33) herb++; else if (d > 0.66) carn++; else omni++;
      for (let i = 0; i < NG; i++) { sum[i] += s.g[i]; sq[i] += s.g[i] * s.g[i]; }
    }
    const n = Math.max(1, L.length);
    const mean = Array.from(sum, v => v / n);
    const sd = Array.from(sq, (v, i) => Math.sqrt(Math.max(0, v / n - mean[i] * mean[i])));
    h.t.push(this.tick); h.pop.push(L.length); h.herb.push(herb); h.omni.push(omni); h.carn.push(carn);
    h.food.push(Food.count); h.mean.push(mean); h.sd.push(sd); h.species.push(Species.snapshot());
    if (h.t.length > 600) {                               // keep memory bounded: halve resolution
      for (const k of ['t', 'pop', 'herb', 'omni', 'carn', 'food', 'mean', 'sd', 'species']) h[k] = h[k].filter((_, i) => i % 2 === 0);
      h.interval *= 2;
    }
  },
};
