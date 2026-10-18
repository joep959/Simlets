'use strict';
// A simlet: body derived from its genome, plus the sense -> decide -> act behaviour.

let NEXT_ID = 1;

class Simlet {
  constructor(genome, x, y, energy, gen, parents) {
    this.id = NEXT_ID++;
    this.g = genome;
    this.x = x; this.y = y;
    this.heading = Math.random() * 2 * Math.PI;
    this.desired = this.heading;
    this.gen = gen; this.parents = parents; this.origin = 'born'; this.species = null;
    this.children = 0; this.kills = 0; this.farmed = 0; this.donated = 0;
    this.age = 0; this.dead = false; this.cause = '';
    this.color = genomeColor(genome); this.look = genomeLook(genome);
    this.derive();
    this.energy = Math.min(energy, this.maxEnergy);
    this.stam = this.staminaMax; this.exhausted = false;

    this.action = 'wander'; this.target = null;
    this.moveSpeed = 0; this.curSpeed = 0; this.sprinting = false;
    this.thinkTimer = (Math.random() * THINK_INTERVAL) | 0; this.needThink = false;
    this.attackCd = 0; this.breedCd = 0; this.alarmCd = 0;
    this.breedMode = null; this.readySince = 0;   // per breeding cycle: 'sex' or 'asex', and when it became ready
    this.alarmTimer = 0; this.alarmFlash = 0;
    this.alert = null; this.alertTimer = 0;
    this.memory = [];
    this.field = null;
    this.brain = null;
    this.inShelter = null; this.working = false;   // shelter tile it is inside; mid build-session
    this.home = null; this.project = null;          // remembered shelter tile indices     // neural-network weights (second chromosome), see brain.js     // home field {x, y, t}: set by farming, pulls the simlet back home
    this.camoEff = 0;
    this.fx = {};                                   // per-simlet event state (e.g. fx.plague), plain JSON: saved as is
    this.range = this.visionRange;
  }

  // Turn 0..1 genes into physical quantities
  derive() {
    const g = this.g;
    this.mass = 0.5 + g[G.size] * 2.5;
    this.radius = 0.35 + g[G.size] * 0.75;                       // tiles
    this.maxEnergy = 40 * this.mass;
    this.maxSpeed = 0.04 + g[G.speed] * 0.14;                     // tiles/tick
    this.fovAngle = (0.25 + g[G.fov] * 1.65) * Math.PI;           // 45°..342°
    // fixed vision budget: cone area ½·angle·range² = VISION_AREA, so range = √(2·area / angle); camo costs vision
    this.visionRange = Math.sqrt(2 * VISION_AREA / this.fovAngle) * (1 - 0.4 * g[G.camo]);
    this.acuity = 1 - 0.7 * g[G.fov];                             // wide eyes are worse at beating camo
    this.maxAge = 5000 + g[G.lifespan] * 15000;
    // idle drain proportional to size; long life, big memory, a keen nose and disease resistance cost upkeep
    this.drainMult = this.mass * (1 + 0.5 * g[G.lifespan]) * (1 + 0.3 * g[G.stamina]) + g[G.memory] * 0.3 + g[G.smell] * 0.2 + g[G.resistance] * 0.25;
    this.scentThreshold = 0.02 + 0.5 * Math.pow(1 - g[G.smell], 2);   // faintest trail it can detect
    this.staminaMax = 40 + 260 * g[G.stamina];                     // ticks of sprinting on a full meter
    this.staminaRegen = 0.3 + 0.7 * g[G.stamina];                  // meter refill per tick when not sprinting
    this.matureAge = MATURE_AGE * (0.6 + 0.8 * g[G.size]);     // big bodies take longer to grow up
    this.memSlots = 1 + Math.round(g[G.memory] * 4);
    this.memDuration = 200 + g[G.memory] * 3000;
    this.brood = 1 + Math.round(g[G.broodSize] * 5);
    this.breedAt = 0.35 + 0.6 * g[G.breedThreshold];             // energy fraction needed to breed
    this.hungerAt = 0.25 + 0.65 * g[G.hunger];                    // below this energy fraction, food is priority
    this.minMateSim = 0.3 + 0.65 * g[G.choosiness];
    this.plantEff = 1 - g[G.diet];                                // digestion efficiency: specialists beat generalists
    this.meatEff = g[G.diet];
  }
}

// ---------- SENSE + DECIDE ----------
function think(s, sim) {
  const g = s.g, tick = sim.tick;
  const night = World.isNight(tick);
  const here = World.at(s.x, s.y), hereInfo = TERRAIN_INFO[here];
  const range = s.visionRange * hereInfo.vision * (night ? 0.6 : 1);
  s.range = range;
  const ef = s.energy / s.maxEnergy, hunger = 1 - ef;
  const ready = s.age >= s.matureAge && s.breedCd === 0 && ef >= s.breedAt;
  // decide once per breeding cycle whether this one is sexual; fall back to asexual if no mate turns up
  if (!ready) s.breedMode = null;
  else if (!s.breedMode) { s.breedMode = Math.random() < g[G.sexuality] ? 'sex' : 'asex'; s.readySince = tick; }
  const cloneNow = ready && (s.breedMode === 'asex' || tick - s.readySince > MATE_WAIT);
  const seekMate = ready && !cloneNow;
  const touch = s.radius + 1.5;               // things this close are felt even outside the cone
  const halfFov = s.fovAngle / 2;
  const cosHalf = Math.cos(halfFov), hx = Math.cos(s.heading), hy = Math.sin(s.heading);
  const inCone = (dx, dy, d) => (dx * hx + dy * hy) / d >= cosHalf;   // dot product: cheaper than atan2
  const drive = ef < s.hungerAt ? 1 + (s.hungerAt - ef) : 0.1 + 0.5 * hunger;   // urge to eat

  // --- sense other simlets ---
  let threat = null, threatScore = 0, prey = null, preyScore = 0, mate = null, mateD = 1e9;
  let kinX = 0, kinY = 0, sepX = 0, sepY = 0, donateTo = null, kinCount = 0, threatD = 0, preyD = 0;
  sim.querySimlets(s.x, s.y, range, o => {
    if (o === s || o.dead || o.inShelter) return;      // simlets inside shelters can't be seen or attacked
    const dx = o.x - s.x, dy = o.y - s.y, d2 = dx * dx + dy * dy;
    if (d2 > range * range) return;
    const d = Math.sqrt(d2) || 0.001;
    if (d > touch) {
      if (!inCone(dx, dy, d)) return;
      const pDetect = 1 - o.camoEff * (1.1 - s.acuity) * (0.5 + 0.5 * d / range);
      if (Math.random() > pDetect) return;
    }
    const sm = similarity(g, o.g), dis = 1 - sm;
    const sizeRatio = o.mass / s.mass;
    const closeness = 1 - 0.5 * d / range;
    const od = o.g[G.diet];                                         // diet is visible (body shape)
    const ts = g[G.flee] * dis * Math.min(sizeRatio, 3) * closeness * (0.3 + 0.7 * od);   // meat-eaters are the scary ones
    if (ts > threatScore) { threatScore = ts; threat = o; threatD = d; }
    // hunting: driven by aggression, and by hunger if this simlet can digest meat
    const ps = dis * Math.min(1 / sizeRatio, 2) * closeness * (1 - 0.7 * od) *       // other meat-eaters make poor, risky prey
               (g[G.aggression] * (0.4 + hunger) * 0.6 + s.meatEff * drive * 0.9);
    if (ps > preyScore) { preyScore = ps; prey = o; preyD = d; }
    if (seekMate && d < mateD && o.age >= o.matureAge && o.breedCd === 0 && o.energy > o.maxEnergy * 0.3 &&
        sm >= s.minMateSim && sm >= o.minMateSim) { mate = o; mateD = d; }
    if (sm > 0.6) {
      kinCount++;
      kinX += dx / d * sm; kinY += dy / d * sm;
      if (!donateTo && d < touch + 1 && o.energy / o.maxEnergy < 0.3) donateTo = o;
    }
    const minD = s.radius + o.radius + 0.3;
    if (d < minD) { sepX -= dx / d * (minD - d); sepY -= dy / d * (minD - d); }
  });

  // --- sense food: optimal foraging, value = net energy (gain minus the cost of reaching and eating it) ---
  const walkV = s.maxSpeed * 0.75;
  const idleBurn = P.idleCost * s.drainMult, moveBurn = idleBurn + P.moveCost * s.mass * (walkV / 0.1) ** 2;
  const netOf = (f, d) => {
    const meat = f.type === 2;
    const handling = f.e / (meat ? MEAT_BITE : P.plantBite), travel = d / walkV;
    return [(meat ? s.meatEff : s.plantEff) * f.e - travel * moveBurn - handling * idleBurn, travel + handling];
  };
  let food = null, foodRate = 0, foodNet = 0, foodD = 0;
  const cur = s.target;
  if (s.action === 'eat' && cur && !cur.removed && Math.hypot(cur.x - s.x, cur.y - s.y) < s.radius + 0.5) {
    // already mid-meal: keep eating this item rather than re-scanning every food item in view
    food = cur; foodNet = netOf(cur, 0)[0] * (cur.type === 2 ? 0.5 + g[G.scavenge] : 1);
  } else Food.query(s.x, s.y, range, f => {
    if (f.removed || f.ready > tick) return;
    const dx = f.x - s.x, dy = f.y - s.y, d2 = dx * dx + dy * dy;
    if (d2 > range * range) return;
    const d = Math.sqrt(d2) || 0.001;
    if (d > touch && !inCone(dx, dy, d)) return;
    const [net, time] = netOf(f, d);
    if (net <= 0) return;                                         // costs more than it gives: ignore
    const pref = f.type === 2 ? 0.5 + g[G.scavenge] : 1;
    const rate = net * pref / time;                               // pick the best energy per tick
    if (rate > foodRate) { foodRate = rate; food = f; foodNet = net * pref; foodD = d; }
  });
  const foodWorth = clamp(foodNet / (P.plantEnergy * 0.5), 0, 1);   // ~1 = a decent meal, 0 = not worth it
  if (food) remember(s, food.x, food.y, tick);
  const mem = food ? null : recall(s, tick);

  // --- score every action (utility AI) and pick the best ---
  // smell: sample plant-eater scent 3 tiles ahead-left, ahead and ahead-right; follow the strongest
  let scentDir = 0, scentBest = 0;
  for (const off of [-0.6, 0, 0.6]) {
    const a = s.heading + off, v = World.scentAt(s.x + Math.cos(a) * 3, s.y + Math.sin(a) * 3);
    if (v > scentBest) { scentBest = v; scentDir = a; }
  }
  const smelt = scentBest > s.scentThreshold ? clamp(scentBest / 1.0, 0, 1) : 0;   // 0 = smells nothing
  const farmable = !!hereInfo.farmKey;
  // hard limits = physically possible; judgements (hungry? danger?) are soft penalties the brain can learn to overrule
  const canFarm = farmable && s.energy >= P.farmCost * 1.5;
  const danger = 1 / (1 + 4 * threatScore);       // ~1 with harmless strangers about, small with a real threat close
  // shelters: family home with room, family store with food, and a place to build
  const hasRoom = sh => sh.done && (sh.occ < SHELTER_CAP || s.inShelter === sh);
  const home = Shelters.remembered(s, 'home', hasRoom) || Shelters.nearestKin(s, hasRoom);
  if (home && s.home == null) s.home = home.sh.ti;  // adopt a family shelter as home
  const store = Shelters.remembered(s, 'home', sh => sh.done && sh.store > 1) || Shelters.nearestKin(s, sh => sh.done && sh.store > 1);
  const site = g[G.building] > 0.02 ? Shelters.findSite(s) : null;
  const canBuild = !!site && s.energy >= Shelters.sessionCost(site.ti) * 1.2;
  const sc = {
    flee:   threat ? threatScore * 1.6 : 0,
    hunt:   prey ? preyScore * (s.attackCd ? 0.6 : 1) : 0,
    eat:    food ? drive * foodWorth * 1.2 : 0,
    recall: mem ? 0.6 * drive * g[G.memory] : 0,
    breed:  seekMate && mate ? 1.3 : 0,
    clone:  cloneNow ? 1.3 * danger : 0,
    farm:   canFarm ? g[G.farming] * 0.9 * (food ? 0.5 : 1) * (ef > 0.5 ? 1 : 0.1) * danger : 0,
    rest:   g[G.rest] * (night ? 1.2 : 0.5) * (food || threat ? 0.3 : 1),
    wander: 0.1 + g[G.wander] * 0.4 + (seekMate && !mate ? 0.3 : 0),
    track:  smelt > 0 && !prey ? 1.5 * smelt * s.meatEff * drive * (0.5 + g[G.smell]) : 0,   // hungry meat-eaters follow trails
    build:  canBuild ? g[G.building] * 0.9 * (ef > 0.5 ? 1 : 0.15) * danger / (1 + (site.d || 0) / 30) : 0,
    shelter: home ? (0.25 + 0.5 * g[G.rest]) * (night ? 1.6 : 0.6) * (World.season(tick) ? 1.5 : 1) * (threat ? 2 : 1) * (food ? 0.5 : 1) / (1 + home.d / 20) : 0,
    // eat from the family granary (crops are plants); thrifty simlets save it unless there's no wild food or they're starving
    draw:   store ? drive * 1.1 * s.plantEff * (ef < 0.2 ? 1 : 1 - g[G.thrift] * (food ? 1 : 0.6)) : 0,
  };
  if (s.alertTimer > 0 && s.alert) sc.flee = Math.max(sc.flee, g[G.flee] * 0.8);
  // hybrid brain: the network adds a learned correction to each available action's score
  if (Brain.mode === 'hybrid' && s.brain) {
    const x = s._bx || (s._bx = new Float32Array(NI)), out = s._bo || (s._bo = new Float32Array(NO));
    x[0] = ef; x[1] = clamp(drive / 2, 0, 1); x[2] = s.stam / s.staminaMax; x[3] = s.exhausted ? 1 : 0;
    x[4] = clamp(threatScore, 0, 1); x[5] = threat ? 1 - threatD / range : 0;
    x[6] = clamp(preyScore, 0, 1); x[7] = prey ? 1 - preyD / range : 0; x[8] = prey ? clamp(prey.mass / s.mass / 3, 0, 1) : 0;
    x[9] = foodWorth; x[10] = food ? 1 - foodD / range : 0;
    x[11] = World.darkness(tick); x[12] = World.season(tick); x[13] = Math.min(1, kinCount / 5);
    x[14] = ready ? 1 : 0; x[15] = s.age / s.maxAge;
    x[16] = hereInfo.forest ? 1 : 0; x[17] = World.wet(s.x, s.y) ? 1 : 0;   // where it's standing
    x[18] = World.freshSoil((s.y | 0) * WORLD_W + (s.x | 0)) ? 1 : 0; x[19] = smelt;
    x[20] = home ? Math.max(0, 1 - home.d / SHELTER_R) : 0; x[21] = store ? Math.min(1, store.sh.store / STORE_CAP) : 0; x[22] = site ? 1 : 0;
    { const bust = World.season(tick) === 1, left = 1 - World.seasonProgress(tick);
      x[23] = bust ? 0 : left; x[24] = bust ? left : 0; }                         // how much boom / bust is left
    x[25] = 1;
    runBrain(s.brain, x, out);
    const avail = { flee: !!(threat || (s.alertTimer > 0 && s.alert)), hunt: !!prey, eat: !!food, recall: !!mem,
                    breed: !!(seekMate && mate), clone: cloneNow, farm: canFarm, rest: true, wander: true, track: smelt > 0,
                    build: canBuild, shelter: !!home, draw: !!store };
    s.baseScores = { ...sc };
    let corr = 0;
    BRAIN_OUT.forEach((k, o) => {
      if (avail[k]) { sc[k] += out[o]; corr += Math.abs(out[o]); }
      else sc[k] = -Infinity;                    // the brain can't pick an action that isn't possible
    });
    sim.brainCorr += corr / NO; sim.brainThinks++;
  } else s.baseScores = null;

  let best = 'wander';
  for (const k in sc) if (sc[k] > sc[best]) best = k;
  // can't farm spent soil: walk to the nearest fresh tile instead (or just wander if none nearby)
  let sowSpot = null;
  if (best === 'farm' && !World.freshSoil((s.y | 0) * WORLD_W + (s.x | 0))) {
    sowSpot = nearestFreshSoil(s.x, s.y, 6);
    best = sowSpot ? 'sow' : 'wander';
  }
  s.scores = sc;
  if (best !== 'shelter') s.inShelter = null;     // anything else means stepping outside
  s.working = false;

  // --- side actions ---
  if (best === 'flee' && threat && s.alarmCd === 0 && Math.random() < g[G.alarm] * 0.5) raiseAlarm(s, threat, sim);
  if (donateTo && ef > 0.6 && Math.random() < g[G.donation] * 0.3) {
    const amt = s.energy * 0.15;
    s.energy -= amt; donateTo.energy = Math.min(donateTo.maxEnergy, donateTo.energy + amt * 0.8);
    s.donated++;
  }

  // --- turn the decision into a direction + speed ---
  let vx = 0, vy = 0, speed = 0;
  const ms = s.maxSpeed;
  s.target = null; s.sprinting = false;
  const toward = (tx, ty, sign = 1) => { const dx = (tx - s.x) * sign, dy = (ty - s.y) * sign, d = Math.hypot(dx, dy) || 1; vx = dx / d; vy = dy / d; return d; };
  switch (best) {
    case 'flee': {
      const src = threat || s.alert;
      toward(src.x, src.y, -1);
      s.sprinting = !s.exhausted && Math.random() < g[G.sprint];
      speed = ms * (s.sprinting ? P.sprintMult : 1);
      s.target = threat;
      break;
    }
    case 'hunt': {
      const d = toward(prey.x, prey.y);
      s.sprinting = !s.exhausted && d < 6 && Math.random() < g[G.sprint];
      speed = ms * (s.sprinting ? P.sprintMult : 1);
      s.target = prey;
      break;
    }
    case 'eat':    toward(food.x, food.y); speed = ms * 0.75; s.target = food; break;
    case 'recall': toward(mem.x, mem.y);   speed = ms * 0.75; s.target = mem;  break;
    case 'breed':  toward(mate.x, mate.y); speed = ms * 0.75; s.target = mate; break;
    case 'clone':  sim.breed(s, null); break;             // asexual: buds off offspring on the spot
    case 'farm':   if (!doFarm(s, sim)) best = 'rest'; break;
    case 'sow':    toward(sowSpot.x, sowSpot.y); speed = ms * 0.6; s.target = sowSpot; break;
    case 'rest':   break;
    case 'track':  vx = Math.cos(scentDir); vy = Math.sin(scentDir); speed = ms * 0.8; break;
    case 'build': {
      if ((s.y | 0) * WORLD_W + (s.x | 0) === site.ti) { s.working = Shelters.work(s, site, tick); if (!s.working) best = 'rest'; }
      else { toward(site.x, site.y); speed = ms * 0.7; s.target = site; }
      break;
    }
    case 'shelter': {
      const sh = home.sh;
      if (s.inShelter === sh || Math.hypot(sh.x - s.x, sh.y - s.y) < 0.7) { s.inShelter = sh; s.x = sh.x; s.y = sh.y; }
      else { toward(sh.x, sh.y); speed = ms * 0.8; s.target = sh; }
      break;
    }
    case 'draw':   toward(store.sh.x, store.sh.y); speed = ms * 0.75; s.target = store.sh; break;
    case 'wander': {
      const a = s.heading + gauss() * 0.25;          // small wobble on current heading = smooth exploring
      vx = Math.cos(a); vy = Math.sin(a);
      speed = ms * (0.3 + 0.5 * g[G.wander]) * (ef < s.hungerAt ? 1.5 : 1);   // hungry = search harder
      const home = fieldOf(s, tick);
      if (home) {                                   // farmers drift back towards their field: settling down
        const dx = home.x - s.x, dy = home.y - s.y, d = Math.hypot(dx, dy);
        if (d > 5) { vx += dx / d * g[G.farming] * 1.2; vy += dy / d * g[G.farming] * 1.2; }
      }
      break;
    }
  }

  // --- steering forces layered on top ---
  if (speed > 0) {
    const kn = Math.hypot(kinX, kinY);
    if (kn > 0 && best !== 'flee' && best !== 'hunt') { vx += kinX / kn * g[G.kinPull] * 0.8; vy += kinY / kn * g[G.kinPull] * 0.8; }
    vx += sepX * 2; vy += sepY * 2;
    if (!World.wet(s.x, s.y)) {                    // probe ahead for open water (ice is fine), push away by aversion gene
      const w = g[G.waterAversion] * 0.9, base = Math.atan2(vy, vx);
      for (const off of [-0.5, 0, 0.5]) {
        const a = base + off;
        if (World.wet(s.x + Math.cos(a) * 2.5, s.y + Math.sin(a) * 2.5)) { vx -= Math.cos(a) * w; vy -= Math.sin(a) * w; }
      }
    }
    const m = 3;                                   // soft walls
    if (s.x < m) vx += (m - s.x) / m * 2; if (s.x > WORLD_W - m) vx -= (s.x - WORLD_W + m) / m * 2;
    if (s.y < m) vy += (m - s.y) / m * 2; if (s.y > WORLD_H - m) vy -= (s.y - WORLD_H + m) / m * 2;
    if (vx !== 0 || vy !== 0) s.desired = Math.atan2(vy, vx);
  }
  s.moveSpeed = speed;
  s.action = best;
}

// ---------- ACT (every tick) ----------
function act(s, sim) {
  // stamina meter: sprinting drains it; when empty, drop to walking until it is 30% refilled
  if (s.sprinting && s.moveSpeed > 0) {
    if (--s.stam <= 0) { s.stam = 0; s.exhausted = true; s.sprinting = false; s.moveSpeed = s.maxSpeed; }
  } else if (s.stam < s.staminaMax) {
    s.stam = Math.min(s.staminaMax, s.stam + s.staminaRegen * (s.action === 'rest' ? 2 : 1));
    if (s.exhausted && s.stam > 0.3 * s.staminaMax) s.exhausted = false;
  }
  s.heading += clamp(wrapAngle(s.desired - s.heading), -0.3, 0.3);
  const here = World.at(s.x, s.y), hereInfo = TERRAIN_INFO[here];
  const inWater = World.wet(s.x, s.y);            // open water; frozen water walks like land
  const v = s.moveSpeed * (inWater ? 0.5 : 1);
  if (v > 0) {
    const r = s.radius;
    let nx = s.x + Math.cos(s.heading) * v, ny = s.y + Math.sin(s.heading) * v;
    if (nx < r || nx > WORLD_W - r || ny < r || ny > WORLD_H - r) {
      nx = clamp(nx, r, WORLD_W - r); ny = clamp(ny, r, WORLD_H - r); s.needThink = true;
    }
    s.x = nx; s.y = ny;
  }
  s.curSpeed = v;
  World.depositScent(s.x, s.y, 0.1 * (1 - s.g[G.diet]));   // plant-eaters smell like prey; pure meat-eaters leave none

  // energy: movement ∝ mass × speed², water multiplies it; idle ∝ mass^0.75; resting halves idle
  const ref = v / 0.1;
  s.energy -= P.moveCost * s.mass * ref * ref * (inWater ? P.waterCost : 1);
  // winter cold: extra idle drain in bust, mostly escaped under forest cover
  const inside = !!s.inShelter;
  const cold = inside ? 0 : World.season(sim.tick) === 1 ? P.winterCold * (hereInfo.coldKey ? 1 - P[hereInfo.coldKey] : 1) : 0;
  s.energy -= P.idleCost * s.drainMult * (1 + cold) * (inside ? 0.25 : s.action === 'rest' || s.action === 'farm' || s.working ? 0.4 : 1);

  // camouflage: breaks with movement, forest boosts it, big bodies show, alarm callers are fully visible
  let c = s.g[G.camo] * 0.85 * (1 - 0.4 * s.g[G.size]);
  if (hereInfo.camo) c = Math.min(1, c + hereInfo.camo);
  c *= 1 - Math.min(1, v / 0.12);
  if (s.alarmTimer > 0) c = 0;
  s.camoEff = c;

  // interactions with the current target
  const t = s.target;
  switch (s.action) {
    case 'eat':
      if (!t || t.removed) { s.needThink = true; break; }
      if (Math.hypot(t.x - s.x, t.y - s.y) < s.radius + 0.5) { s.moveSpeed = 0; bite(s, t); }
      break;
    case 'hunt':
      if (!t || t.dead || t.inShelter) { s.needThink = true; break; }   // prey dead or hidden indoors
      // a sprinting predator can pounce from further away
      if (Math.hypot(t.x - s.x, t.y - s.y) < s.radius + t.radius + (s.sprinting ? 1.2 : 0.3) && s.attackCd === 0) attack(s, t, sim);
      break;
    case 'breed':
      if (!t || t.dead || t.breedCd > 0 || s.breedCd > 0) { s.needThink = true; break; }
      if (Math.hypot(t.x - s.x, t.y - s.y) < s.radius + t.radius + 0.6) sim.breed(s, t);
      break;
    case 'sow':
      if (!t || Math.hypot(t.x - s.x, t.y - s.y) < 0.6) s.needThink = true;   // arrived on fresh soil: decide again (farm)
      break;
    case 'build': case 'shelter':
      if (t && Math.hypot(t.x - s.x, t.y - s.y) < 0.6) s.needThink = true;    // arrived: start work / go inside
      break;
    case 'draw':
      if (!t || !Shelters.tiles.has(t.ti) || t.store <= 0.01 || s.energy >= s.maxEnergy * 0.95) { s.needThink = true; break; }
      if (Math.hypot(t.x - s.x, t.y - s.y) < 1.2) {
        s.moveSpeed = 0;
        const amt = Math.min(t.store, 2);
        t.store -= amt; s.energy = Math.min(s.maxEnergy, s.energy + amt * s.plantEff);
      }
      break;
    case 'recall':
      if (Math.hypot(t.x - s.x, t.y - s.y) < 1.5) {
        const i = s.memory.indexOf(t); if (i >= 0) s.memory.splice(i, 1);
        if (t === s.field) t.t = sim.tick;            // visiting the field keeps it remembered
        s.needThink = true;
      }
      break;
  }
}

function bite(s, f) {
  const amt = Math.min(f.e, f.type === 2 ? MEAT_BITE : P.plantBite);   // plants are slow to eat, meat is quick
  f.e -= amt;
  if (f.type === 0) World.browse(f.x, f.y, amt / P.plantEnergy);   // grazing keeps young trees down
  const eff = f.type === 2 ? s.meatEff : s.plantEff;
  s.energy = Math.min(s.maxEnergy, s.energy + amt * eff);
  if (f.e <= 0.01) { Food.remove(f); s.needThink = true; }
}

function attack(s, o, sim) {
  s.attackCd = ATTACK_COOLDOWN;
  s.energy -= P.attackCost * Math.pow(s.mass, 0.75);
  const sa = s.mass * (0.5 + 0.5 * s.energy / s.maxEnergy);
  const sd = o.mass * (0.5 + 0.5 * o.energy / o.maxEnergy);
  if (Math.random() < sa / (sa + sd)) {
    sim.kill(o, 'killed'); s.kills++; s.needThink = true;
  } else {
    o.energy -= P.attackCost * 0.5;                // injured but escaped
    o.alert = { x: s.x, y: s.y }; o.alertTimer = 60; o.needThink = true;
  }
}

function doFarm(s, sim) {
  const farmKey = TERRAIN_INFO[World.at(s.x, s.y)].farmKey, mult = farmKey ? P[farmKey] : 0;
  const hereTi = (s.y | 0) * WORLD_W + (s.x | 0);
  if (!mult || s.energy < P.farmCost * 1.5 || World.soil[hereTi] < SOIL_MIN) return false;
  s.energy -= P.farmCost;
  // yield = land type × remaining nutrients; farming then exhausts the soil it uses
  // neighbouring active fields (+12.5% each, up to +50%) and a finished house within 2 tiles (+25%) raise the yield
  const hx = s.x | 0, hy = s.y | 0;
  let nearFields = 0, nearHouse = false;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const nx = hx + dx, ny = hy + dy; if (nx < 0 || ny < 0 || nx >= WORLD_W || ny >= WORLD_H) continue;
    const ni = ny * WORLD_W + nx;
    if (Math.abs(dx) + Math.abs(dy) === 1) { const t = World.tilled.get(ni); if (t !== undefined && sim.tick - t < 2000) nearFields++; }
    const sh = Shelters.tiles.get(ni); if (sh && sh.done) nearHouse = true;
  }
  const bonus = (1 + 0.125 * Math.min(4, nearFields)) * (nearHouse ? 1.25 : 1);
  const total = P.farmCost * mult * World.soil[hereTi] * bonus, n = Math.max(1, Math.round(total / P.plantEnergy));
  World.setSoil(hereTi, 0); World.clearTrees(hereTi);          // farming clears saplings off the field
  for (let i = 0; i < n; i++) {
    const a = Math.random() * 2 * Math.PI, r = 0.5 + Math.random() * 1.5;
    const x = clamp(s.x + Math.cos(a) * r, 0.05, WORLD_W - 0.05), y = clamp(s.y + Math.sin(a) * r, 0.05, WORLD_H - 0.05);
    const ti = (y | 0) * WORLD_W + (x | 0);
    if (World.at(x, y) === TERRAIN.WATER) continue;
    if (Food.tileCount[ti] >= P.tileCap + 2) continue;
    if (ti !== hereTi) { if (World.soil[ti] < SOIL_MIN) continue; World.setSoil(ti, World.soil[ti] - 0.5); World.clearTrees(ti); }   // neighbouring plots tire too
    Food.add({ x, y, e: total / n, born: sim.tick, ready: sim.tick + FARM_GROW_TIME, type: 1 });
    World.tilled.set((y | 0) * WORLD_W + (x | 0), sim.tick);
  }
  // remember this as the home field (keep the old centre if farming close to it)
  if (s.field && Math.hypot(s.field.x - s.x, s.field.y - s.y) < 6) s.field.t = sim.tick;
  else s.field = { x: s.x, y: s.y, t: sim.tick };
  World.tilled.set((s.y | 0) * WORLD_W + (s.x | 0), sim.tick);
  s.farmed++;
  sim.farmEvents++;
  return true;
}

function raiseAlarm(s, threat, sim) {
  s.alarmCd = 300; s.alarmTimer = 60; s.alarmFlash = 30;
  s.energy -= 2 * Math.pow(s.mass, 0.75);
  sim.alarms++;
  sim.querySimlets(s.x, s.y, 12, o => {
    if (o === s || o.dead) return;
    if (similarity(s.g, o.g) > 0.5) { o.alert = { x: threat.x, y: threat.y }; o.alertTimer = 80; o.needThink = true; }
  });
}

// Nearest farmable tile with fresh (non-dormant) soil within r tiles, as a point at the tile centre
function nearestFreshSoil(x, y, r) {
  let best = null, bd = 1e9;
  const x0 = Math.max(0, (x - r) | 0), x1 = Math.min(WORLD_W - 1, (x + r) | 0);
  const y0 = Math.max(0, (y - r) | 0), y1 = Math.min(WORLD_H - 1, (y + r) | 0);
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
    if (!World.freshSoil(ty * WORLD_W + tx)) continue;
    const d = Math.hypot(tx + 0.5 - x, ty + 0.5 - y);
    if (d < bd) { bd = d; best = { x: tx + 0.5, y: ty + 0.5 }; }
  }
  return best;
}

// Memory: a few remembered food spots that fade after memDuration ticks
function remember(s, x, y, tick) {
  for (const m of s.memory) if (Math.abs(m.x - x) < 3 && Math.abs(m.y - y) < 3) { m.t = tick; return; }
  s.memory.push({ x, y, t: tick });
  if (s.memory.length > s.memSlots) s.memory.shift();
}
function recall(s, tick) {
  s.memory = s.memory.filter(m => tick - m.t < s.memDuration);
  let best = null, bd = 1e9;
  const spots = s.memory.slice(); const home = fieldOf(s, tick); if (home) spots.push(home);
  for (const m of spots) { const d = Math.hypot(m.x - s.x, m.y - s.y); if (d < bd && d > 1.5) { bd = d; best = m; } }
  return best;
}
// The home field is long-term memory: kept for 3× the Memory gene's duration since last farmed or visited
function fieldOf(s, tick) {
  if (s.field && tick - s.field.t > 3 * s.memDuration) s.field = null;
  return s.field;
}
