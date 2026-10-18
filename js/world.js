'use strict';
// Terrain grid, food storage, seasons and day/night.
// Living land: only water vs land is painted. Each land tile carries moisture (from distance to water), soil
// nutrients and tree cover; its type (fertile / grassland / forest) is worked out from those (deriveType) and
// changes as simlets graze, farm and build. Everything else just reads World.terrain / World.at().

const World = {
  terrain: new Uint8Array(WORLD_W * WORLD_H),       // derived type per tile (TERRAIN.*); WATER is painted
  typeTiles: TERRAIN_INFO.map(() => []),            // land tile indices per terrain type (water's list stays empty)
  fertileTiles: [],                                  // = typeTiles[FERTILE], [GRASS], [FOREST]: kept as shorthands
  grassTiles: [],
  forestTiles: [],
  landTiles: [],
  shoreDist: new Float32Array(WORLD_W * WORLD_H),   // water tiles: distance to nearest land (tiles)
  moist: new Float32Array(WORLD_W * WORLD_H),       // land tiles: moisture 0..1 from distance to water
  waterDist: new Float32Array(WORLD_W * WORLD_H),   // land tiles: distance to the nearest water (tiles, diagonal 1.414); water 0
  flood: new Uint8Array(WORLD_W * WORLD_H),         // 1 = land temporarily under floodwater (events): wet, grows no wild food
  floodTiles: new Set(),                             // flooded tile indices (for drawing and saving); change via setFlood
  trees: new Float32Array(WORLD_W * WORLD_H),       // tree cover 0..1
  look: new Uint8Array(WORLD_W * WORLD_H),          // last drawn appearance key per tile (type, soil and tree level)
  redraw: [],                                        // tiles whose appearance changed since the last draw
  ice: new Uint8Array(WORLD_W * WORLD_H),           // 1 = frozen water
  iceTiles: [],                                      // frozen tile indices (for drawing)
  iceNoise: null,
  scent: new Float32Array(WORLD_W * WORLD_H),       // plant-eater scent per tile (fades over time)
  dirty: true,      // whole map changed -> renderer rebuilds its cached image
  soil: new Float32Array(WORLD_W * WORLD_H).fill(1),   // nutrients 0..1 per tile
  depleted: new Set(),  // tiles currently below SOIL_MIN (for drawing fallow land)
  tilled: new Map(),  // tile index -> tick last farmed (drawn as farmland; visual only)

  at(x, y) {
    const tx = x | 0, ty = y | 0;
    if (tx < 0 || ty < 0 || tx >= WORLD_W || ty >= WORLD_H) return TERRAIN.WATER;
    return this.terrain[ty * WORLD_W + tx];
  },

  // After the water layout changes (map edit, load, generate): shores, moisture and ice, then the land types
  rebuildLists() {
    this.computeShoreDistance();
    this.computeMoisture();
    this.refreshLand(true);
    this.updateIce(typeof Sim !== 'undefined' ? Sim.tick : 0);   // recompute, don't clear: terrain can change mid-winter
    this.dirty = true;
  },

  // Re-derive every land tile's type; rebuild the per-type lists only if a type changed (or `all`, after the water
  // changed). Tiles that now look different go on the redraw list so the renderer only repaints those.
  refreshLand(all) {
    const terrain = this.terrain, look = this.look, WATER = TERRAIN.WATER;
    let changed = !!all;
    for (let i = 0; i < terrain.length; i++) {
      const old = terrain[i];
      if (old === WATER) { if (look[i] !== 255) { look[i] = 255; this.redraw.push(i); } continue; }
      const t = this.deriveType(i);
      if (t !== old) { terrain[i] = t; changed = true; }
      const k = this.lookKey(i);
      if (k !== look[i]) { look[i] = k; this.redraw.push(i); }
    }
    if (changed) {
      const lists = this.typeTiles = TERRAIN_INFO.map(() => []); this.landTiles = [];
      for (let i = 0; i < terrain.length; i++) {
        const t = terrain[i];
        if (t === WATER) continue;
        this.landTiles.push(i);
        lists[t].push(i);
      }
      this.fertileTiles = lists[TERRAIN.FERTILE]; this.grassTiles = lists[TERRAIN.GRASS]; this.forestTiles = lists[TERRAIN.FOREST];
    }
    if (this.redraw.length > 4000) { this.redraw.length = 0; this.dirty = true; }   // a full repaint is cheaper (and headless never drains it)
  },
  // forest if enough trees, else fertile if rich soil, else grassland; each with a gap between on and off levels
  deriveType(i) {
    const t = this.terrain[i];
    if (this.trees[i] >= (t === TERRAIN.FOREST ? FOREST_OFF : FOREST_ON)) return TERRAIN.FOREST;
    return this.soil[i] >= (t === TERRAIN.FERTILE ? FERTILE_OFF : FERTILE_ON) ? TERRAIN.FERTILE : TERRAIN.GRASS;
  },
  // appearance: type plus coarse soil and tree levels (so creeping saplings and wearing-out land are visible)
  lookKey(i) {
    const t = this.terrain[i];
    if (t === TERRAIN.WATER) return 255;
    return t * 16 + Math.min(3, (this.soil[i] * 4) | 0) * 4 + Math.min(3, (this.trees[i] * 5) | 0);
  },
  // how rich the soil can get on its own: poor far from water, rich beside it
  soilCap(i) { return 0.35 + 0.65 * this.moist[i]; },

  // Moisture: breadth-first distance from water over land, then rain plus an exponential fall-off from the shore
  computeMoisture() {
    const W = WORLD_W, H = WORLD_H;
    this.waterDist.set(this.waterDistance(true));   // land distance to water (also used by floods); 1e9 if there is no water
    const d = this.waterDist;
    for (let i = 0; i < W * H; i++) this.moist[i] = this.terrain[i] === TERRAIN.WATER ? 1 : MOIST_BASE + (1 - MOIST_BASE) * Math.exp(-(d[i] - 1) / MOIST_RANGE);
  },
  // distance from every tile to the nearest water (8-neighbour steps, diagonal 1.414); full = unbounded queue
  waterDistance(full) {
    const W = WORLD_W, H = WORLD_H, d = new Float32Array(W * H), q = full ? [] : new Int32Array(W * H);
    let head = 0, tail = 0;
    for (let i = 0; i < W * H; i++) { if (this.terrain[i] === TERRAIN.WATER) { d[i] = 0; q[tail++] = i; } else d[i] = 1e9; }
    while (head < tail) {
      const i = q[head++], x = i % W, y = (i / W) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx, step = dx && dy ? 1.414 : 1;
        if (d[j] > d[i] + step) { d[j] = d[i] + step; q[tail++] = j; }
      }
    }
    return d;
  },

  // Trees (every 100 ticks): each tile grows toward the cover its moisture supports, seeded by neighbouring forest,
  // so forest edges creep onto moist land. Dry land supports only scrub, which doesn't seed further, so dry-land
  // forests keep a thin fringe instead of spreading. Shelter tiles stay clear.
  growTrees(ticks) {
    const W = WORLD_W, H = WORLD_H, T = this.trees, r = TREE_RATE * P.treeGrowth * ticks;
    if (r <= 0) return;
    const next = this._treeBuf || (this._treeBuf = new Float32Array(W * H));
    next.set(T);
    for (const i of this.landTiles) {
      if (Shelters.tiles.has(i)) { next[i] = 0; continue; }
      const x = i % W, y = (i / W) | 0;
      let sum = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < W && ny < H && TERRAIN_INFO[this.terrain[ny * W + nx]].forest) sum += T[ny * W + nx];   // only established forest seeds
      }
      const K = 0.4 + 0.6 * this.moist[i];
      next[i] = clamp(T[i] + r * (T[i] + TREE_SEED * sum / 8) * (K - T[i]), 0, 1);
    }
    T.set(next);
  },
  // a grazer eating a wild plant here nibbles young trees back (established forest is unaffected)
  browse(x, y, frac) {
    const i = (y | 0) * WORLD_W + (x | 0);
    if (!TERRAIN_INFO[this.terrain[i]].forest && this.trees[i] > 0) this.trees[i] = Math.max(0, this.trees[i] - BROWSE * frac);
  },
  clearTrees(i) { this.trees[i] = 0; },

  // Breadth-first search outward from every land tile: each water tile gets its distance (8-neighbour steps) to land
  computeShoreDistance() {
    const W = WORLD_W, H = WORLD_H, d = this.shoreDist, q = new Int32Array(W * H);
    let head = 0, tail = 0;
    for (let i = 0; i < W * H; i++) { if (this.terrain[i] === TERRAIN.WATER) d[i] = 1e9; else { d[i] = 0; q[tail++] = i; } }
    while (head < tail) {
      const i = q[head++], x = i % W, y = (i / W) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (d[j] > d[i] + 1) { d[j] = d[i] + 1; q[tail++] = j; }
      }
    }
    if (!this.iceNoise) {                        // fixed smooth noise so ice edges look organic, same every winter
      const n = makeNoise(); this.iceNoise = new Float32Array(W * H);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) this.iceNoise[y * W + x] = (fbm(n, x / 6, y / 6) - 0.5) * 3;
    }
  },

  // Ice: during bust a reach grows from the shore (0 -> iceReach -> 0). A water tile freezes when its shore distance
  // (plus fixed noise) is within reach. Then a 3x3 morphological closing (dilate, then erode) fills pinholes and
  // joins nearby floes into solid sheets.
  updateIce(tick) {
    const W = WORLD_W, H = WORLD_H, raw = new Uint8Array(W * H);
    const reach = this.season(tick) === 1 ? P.iceReach * Math.sin(Math.PI * this.seasonProgress(tick)) : 0;
    let any = false;
    if (reach > 0) for (let i = 0; i < W * H; i++)
      if (this.terrain[i] === TERRAIN.WATER && this.shoreDist[i] + this.iceNoise[i] <= reach) { raw[i] = 1; any = true; }
    if (!any) { if (this.iceTiles.length) { this.ice.fill(0); this.iceTiles = []; } return; }
    const isWater = i => this.terrain[i] === TERRAIN.WATER;
    const dil = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x; if (!isWater(i)) continue;
      let f = 0;
      for (let dy = -1; dy <= 1 && !f; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < W && ny < H && raw[ny * W + nx]) { f = 1; break; }
      }
      dil[i] = f;
    }
    this.ice.fill(0); this.iceTiles = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x; if (!dil[i]) continue;
      let keep = 1;                              // erosion: land and map edges count as solid, so shores don't erode
      for (let dy = -1; dy <= 1 && keep; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (isWater(j) && !dil[j]) { keep = 0; break; }
      }
      if (keep) { this.ice[i] = 1; this.iceTiles.push(i); }
    }
  },
  // scent: deposited by every simlet in proportion to how plant-eating it is, capped, fading with a half-life
  depositScent(x, y, amount) {
    const tx = x | 0, ty = y | 0;
    if (tx < 0 || ty < 0 || tx >= WORLD_W || ty >= WORLD_H) return;
    const i = ty * WORLD_W + tx; this.scent[i] = Math.min(5, this.scent[i] + amount);
  },
  fadeScent(ticks) {
    const k = Math.pow(0.5, ticks / P.scentFade), s = this.scent;
    for (let i = 0; i < s.length; i++) if (s[i] > 0) { s[i] *= k; if (s[i] < 0.002) s[i] = 0; }
  },
  scentAt(x, y) {
    const tx = x | 0, ty = y | 0;
    return tx < 0 || ty < 0 || tx >= WORLD_W || ty >= WORLD_H ? 0 : this.scent[ty * WORLD_W + tx];
  },

  // open (unfrozen) water or flooded land at a position: what actually slows and costs a simlet
  wet(x, y) {
    const tx = x | 0, ty = y | 0;
    if (tx < 0 || ty < 0 || tx >= WORLD_W || ty >= WORLD_H) return true;
    const i = ty * WORLD_W + tx;
    return (this.terrain[i] === TERRAIN.WATER && !this.ice[i]) || this.flood[i] === 1;
  },
  // floodwater on a tile (events): on = true floods it, false drains it
  setFlood(i, on) {
    if (on) { if (!this.flood[i]) { this.flood[i] = 1; this.floodTiles.add(i); } }
    else if (this.flood[i]) { this.flood[i] = 0; this.floodTiles.delete(i); }
  },
  clearFlood() { if (this.floodTiles.size) { this.flood.fill(0); this.floodTiles.clear(); } },

  // soil back to what each tile's moisture supports (moisture must be computed first)
  resetSoil() { this.depleted.clear(); for (let i = 0; i < this.soil.length; i++) this.setSoil(i, this.terrain[i] === TERRAIN.WATER ? 1 : this.soilCap(i)); },
  // nutrients: used up by farming, recovered over time (grassland at half speed), topped up by decay
  setSoil(ti, v) {
    v = clamp(v, 0, 1);
    const was = this.soil[ti] < SOIL_MIN; this.soil[ti] = v;
    if ((v < SOIL_MIN) !== was) { if (v < SOIL_MIN) this.depleted.add(ti); else this.depleted.delete(ti); }   // only touch the set on a crossing
  },
  addNutrients(x, y, amount) {
    const tx = x | 0, ty = y | 0;
    if (tx < 0 || ty < 0 || tx >= WORLD_W || ty >= WORLD_H) return;
    const ti = ty * WORLD_W + tx;
    if (this.soil[ti] < 1) this.setSoil(ti, this.soil[ti] + amount);
  },
  // soil drifts toward what its moisture supports: recovers when below (faster when moist), leaches slowly when above
  recoverSoil(ticks) {
    const step = ticks / P.soilRecovery, L = this.landTiles, soil = this.soil, moist = this.moist;
    for (let k = 0; k < L.length; k++) {
      const ti = L[k], s = soil[ti], m = moist[ti], cap = Math.fround(0.35 + 0.65 * m);   // = soilCap(ti), inlined; fround so a tile at its cap compares equal
      if (s === cap) continue;
      const v = s < cap ? Math.min(cap, s + step * (0.5 + 0.5 * m)) : Math.max(cap, s - step * 0.25);
      if ((s < SOIL_MIN) !== (v < SOIL_MIN)) this.setSoil(ti, v); else soil[ti] = v;
    }
  },
  // every 100 ticks: trees grow and spread, then tile types are re-derived
  updateLand(ticks) { this.growTrees(ticks); this.refreshLand(); },
  freshSoil(ti) { return !!TERRAIN_INFO[this.terrain[ti]].farmKey && this.soil[ti] >= SOIL_MIN && !Shelters.tiles.has(ti); },   // farmable and not dormant

  // brushes (BRUSHES in config.js): water and land reshape the map; forest and enrich are godly nudges to land
  paint(cx, cy, radius, brush) {
    const r2 = radius * radius;
    for (let y = Math.floor(cy - radius); y <= cy + radius; y++)
      for (let x = Math.floor(cx - radius); x <= cx + radius; x++) {
        if (x < 0 || y < 0 || x >= WORLD_W || y >= WORLD_H) continue;
        if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 > r2) continue;
        const i = y * WORLD_W + x, water = this.terrain[i] === TERRAIN.WATER;
        if (brush === 'water') { this.terrain[i] = TERRAIN.WATER; this.trees[i] = 0; this.setSoil(i, 1); continue; }
        if (brush === 'land') { this.terrain[i] = TERRAIN.GRASS; this.trees[i] = 0; this.setSoil(i, water ? 0.5 : this.soilCap(i)); }
        else if (water) continue;                                     // forest and enrich only work on land
        else if (brush === 'forest') this.trees[i] = 1;
        else if (brush === 'enrich') this.setSoil(i, 1);
        this.terrain[i] = this.deriveType(i);
      }
    this.dirty = true;
  },

  fill(type) {
    this.terrain.fill(type); this.trees.fill(0);
    this.computeMoisture(); this.resetSoil(); this.rebuildLists();
  },

  // Random map: lakes and a river are painted; soil starts at what moisture supports (so fertile land follows the
  // water) and forests are seeded from noise wherever the land is moist enough to hold them
  generate() {
    const n2 = makeNoise(), n3 = makeNoise();
    for (let y = 0; y < WORLD_H; y++) for (let x = 0; x < WORLD_W; x++) {
      let t = TERRAIN.GRASS;
      if (fbm(n3, x / 35, y / 35) < 0.3) t = TERRAIN.WATER;            // lakes
      const riverX = WORLD_W * 0.5 + 14 * Math.sin(y / 15) + 5 * Math.sin(y / 5.3);
      if (Math.abs(x - riverX) < 2.2) t = TERRAIN.WATER;                // river splitting the map
      this.terrain[y * WORLD_W + x] = t;
    }
    this.computeMoisture();
    for (let y = 0; y < WORLD_H; y++) for (let x = 0; x < WORLD_W; x++) {
      const i = y * WORLD_W + x;
      this.trees[i] = this.terrain[i] !== TERRAIN.WATER && fbm(n2, x / 22, y / 22) > 0.6 ? 1 : 0;   // on dry land these thin out but stay forest; they just cannot spread
    }
    this.resetSoil();
    this.rebuildLists();
  },

  // Terrain encoding (map files and saves): one base-36 character per tile (0-9 then a-z), so up to 36 terrain
  // types fit. While every type is below 10 this is exactly the old one-digit-per-tile string, so old files load
  // unchanged and new files stay readable by old code. decodeTerrain also accepts a plain number array.
  encodeTerrain() { let s = ''; for (let i = 0; i < this.terrain.length; i++) s += this.terrain[i].toString(36); return s; },
  decodeTerrain(data) {
    for (let i = 0; i < data.length; i++) this.terrain[i] = typeof data === 'string' ? parseInt(data[i], 36) : data[i];
  },

  // Map file: painted water plus the living layers (trees, soil). Old maps (no version) only had painted types:
  // they're converted so painted forest becomes trees and painted fertile land becomes enriched soil.
  toJSON() {
    const q = a => Array.from(a, v => Math.round(v * 100) / 100);
    return JSON.stringify({ w: WORLD_W, h: WORLD_H, v: 2, data: this.encodeTerrain(), trees: q(this.trees), soil: q(this.soil) });
  },
  fromJSON(text) {
    const o = JSON.parse(text);
    if (o.w !== WORLD_W || o.h !== WORLD_H || o.data.length !== WORLD_W * WORLD_H) throw new Error('Map size mismatch');
    this.decodeTerrain(o.data);
    this.computeMoisture();
    if (o.v >= 2) {
      this.trees.set(o.trees);
      this.soil.set(o.soil); this.depleted.clear(); for (let i = 0; i < this.soil.length; i++) if (this.soil[i] < SOIL_MIN) this.depleted.add(i);
    } else {
      this.resetSoil();
      for (let i = 0; i < this.terrain.length; i++) {
        const t = this.terrain[i];
        this.trees[i] = t === TERRAIN.FOREST ? 1 : 0;
        if (t === TERRAIN.FERTILE) this.setSoil(i, 1);
        else if (t === TERRAIN.GRASS) this.setSoil(i, Math.min(this.soil[i], FERTILE_ON - 0.1));
      }
    }
    this.rebuildLists();
  },

  // ---- time ----
  // A year = 2 × seasonLength ticks; bustShare of it is bust. 0 = boom, 1 = bust.
  season(tick) { const y = 2 * P.seasonLength; return (tick % y) < y * (1 - P.bustShare) ? 0 : 1; },
  seasonProgress(tick) {                                                     // 0..1 through the current season
    const y = 2 * P.seasonLength, boom = y * (1 - P.bustShare), ph = tick % y;
    return ph < boom ? ph / boom : (ph - boom) / (y - boom);
  },
  darkness(tick) {                                                           // 0 noon .. 1 midnight
    const t = (tick % P.dayLength) / P.dayLength;
    return clamp(-Math.cos(2 * Math.PI * t) * 1.5 + 0.25, 0, 1);
  },
  isNight(tick) { return this.darkness(tick) > 0.5; },
};

// World upkeep, run from Sim.step (see registerSystem in config.js). Order matters: soil, scent, land, ice.
registerSystem({ name: 'soil',  every: 25,  update() { World.recoverSoil(25); }, reset() { World.tilled.clear(); } });
registerSystem({ name: 'scent', every: 25,  update() { World.fadeScent(25); },   reset() { World.scent.fill(0); } });
registerSystem({ name: 'land',  every: 100, update() { World.updateLand(100); } });
registerSystem({ name: 'ice',   every: 100, update(tick) { World.updateIce(tick); }, reset() { World.ice.fill(0); World.iceTiles = []; } });

// ---- Food store: spatial buckets so "what food is near me" is fast ----
// Food item: { x, y, e, born, ready, type: 0 wild plant | 1 farmed | 2 corpse, removed }
const FOOD_CELL = 5;
const Food = {
  cw: Math.ceil(WORLD_W / FOOD_CELL), ch: Math.ceil(WORLD_H / FOOD_CELL),
  cells: null, tileCount: new Uint8Array(WORLD_W * WORLD_H), count: 0,

  reset() {
    this.cells = Array.from({ length: this.cw * this.ch }, () => []);
    this.tileCount.fill(0); this.count = 0;
  },
  tileIndex(f) { return (f.y | 0) * WORLD_W + (f.x | 0); },
  add(f) {
    const c = ((f.y / FOOD_CELL) | 0) * this.cw + ((f.x / FOOD_CELL) | 0);
    f.cell = c; f.idx = this.cells[c].length; f.removed = false;
    this.cells[c].push(f);
    if (f.type !== 2) this.tileCount[this.tileIndex(f)]++;
    this.count++;
  },
  remove(f) {
    if (f.removed) return;
    const arr = this.cells[f.cell], last = arr.pop();
    if (last !== f) { arr[f.idx] = last; last.idx = f.idx; }
    f.removed = true;
    if (f.type !== 2) this.tileCount[this.tileIndex(f)]--;
    this.count--;
  },
  query(x, y, r, cb) {
    const x0 = Math.max(0, ((x - r) / FOOD_CELL) | 0), x1 = Math.min(this.cw - 1, ((x + r) / FOOD_CELL) | 0);
    const y0 = Math.max(0, ((y - r) / FOOD_CELL) | 0), y1 = Math.min(this.ch - 1, ((y + r) / FOOD_CELL) | 0);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      const arr = this.cells[cy * this.cw + cx];
      for (let i = 0; i < arr.length; i++) cb(arr[i]);
    }
  },
  forEach(cb) { for (const arr of this.cells) for (let i = arr.length - 1; i >= 0; i--) cb(arr[i]); },
  removeOnWater() {
    this.forEach(f => { if (f.type !== 2 && World.at(f.x, f.y) === TERRAIN.WATER) this.remove(f); });
  },
};
Food.reset();

// ---- tiny value-noise for map generation ----
function makeNoise() {
  const N = 256, vals = new Float32Array(N * N);
  for (let i = 0; i < vals.length; i++) vals[i] = Math.random();
  const v = (x, y) => vals[((y & (N - 1)) * N) + (x & (N - 1))];
  const s = t => t * t * (3 - 2 * t);
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = s(x - xi), yf = s(y - yi);
    const a = v(xi, yi), b = v(xi + 1, yi), c = v(xi, yi + 1), d = v(xi + 1, yi + 1);
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  };
}
function fbm(noise, x, y) { return (noise(x, y) * 4 + noise(x * 2, y * 2) * 2 + noise(x * 4, y * 4)) / 7; }
