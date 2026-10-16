'use strict';
// Terrain grid, food storage, seasons and day/night.

const World = {
  terrain: new Uint8Array(WORLD_W * WORLD_H),
  fertileTiles: [],
  grassTiles: [],
  dirty: true,      // terrain changed -> renderer rebuilds its cached image
  soil: new Float32Array(WORLD_W * WORLD_H).fill(1),   // nutrients 0..1 per tile
  depleted: new Set(),  // tiles currently below SOIL_MIN (for drawing fallow land)
  tilled: new Map(),  // tile index -> tick last farmed (drawn as farmland; visual only)

  at(x, y) {
    const tx = x | 0, ty = y | 0;
    if (tx < 0 || ty < 0 || tx >= WORLD_W || ty >= WORLD_H) return TERRAIN.WATER;
    return this.terrain[ty * WORLD_W + tx];
  },

  rebuildLists() {
    this.fertileTiles = []; this.grassTiles = [];
    for (let i = 0; i < this.terrain.length; i++) {
      if (this.terrain[i] === TERRAIN.FERTILE) this.fertileTiles.push(i);
      else if (this.terrain[i] === TERRAIN.GRASS) this.grassTiles.push(i);
    }
    this.dirty = true;
  },

  resetSoil() { this.soil.fill(1); this.depleted.clear(); },
  // nutrients: used up by farming, recovered over time (grassland at half speed), topped up by decay
  setSoil(ti, v) {
    v = clamp(v, 0, 1); this.soil[ti] = v;
    if (v < SOIL_MIN) this.depleted.add(ti); else this.depleted.delete(ti);
  },
  addNutrients(x, y, amount) {
    const tx = x | 0, ty = y | 0;
    if (tx < 0 || ty < 0 || tx >= WORLD_W || ty >= WORLD_H) return;
    const ti = ty * WORLD_W + tx;
    if (this.soil[ti] < 1) this.setSoil(ti, this.soil[ti] + amount);
  },
  recoverSoil(ticks) {
    const step = ticks / P.soilRecovery;
    for (const [list, k] of [[this.fertileTiles, 1], [this.grassTiles, 0.5]])
      for (let i = 0; i < list.length; i++) { const ti = list[i]; if (this.soil[ti] < 1) this.setSoil(ti, this.soil[ti] + step * k); }
  },
  freshSoil(ti) { const t = this.terrain[ti]; return (t === TERRAIN.FERTILE || t === TERRAIN.GRASS) && this.soil[ti] >= SOIL_MIN; },

  paint(cx, cy, radius, type) {
    const r2 = radius * radius;
    for (let y = Math.floor(cy - radius); y <= cy + radius; y++)
      for (let x = Math.floor(cx - radius); x <= cx + radius; x++) {
        if (x < 0 || y < 0 || x >= WORLD_W || y >= WORLD_H) continue;
        if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 > r2) continue;
        this.terrain[y * WORLD_W + x] = type;
        this.setSoil(y * WORLD_W + x, 1);
      }
    this.dirty = true;
  },

  fill(type) { this.terrain.fill(type); this.resetSoil(); this.rebuildLists(); },

  generate() {
    const n1 = makeNoise(), n2 = makeNoise(), n3 = makeNoise();
    for (let y = 0; y < WORLD_H; y++) for (let x = 0; x < WORLD_W; x++) {
      let t = TERRAIN.GRASS;
      if (fbm(n1, x / 28, y / 28) > 0.56) t = TERRAIN.FERTILE;
      if (fbm(n2, x / 22, y / 22) > 0.6) t = TERRAIN.FOREST;
      if (fbm(n3, x / 35, y / 35) < 0.3) t = TERRAIN.WATER;            // lakes
      const riverX = WORLD_W * 0.5 + 14 * Math.sin(y / 15) + 5 * Math.sin(y / 5.3);
      if (Math.abs(x - riverX) < 2.2) t = TERRAIN.WATER;                // river splitting the map
      this.terrain[y * WORLD_W + x] = t;
    }
    this.resetSoil();
    this.rebuildLists();
  },

  toJSON() { return JSON.stringify({ w: WORLD_W, h: WORLD_H, data: Array.from(this.terrain).join('') }); },
  fromJSON(text) {
    const o = JSON.parse(text);
    if (o.w !== WORLD_W || o.h !== WORLD_H || o.data.length !== WORLD_W * WORLD_H) throw new Error('Map size mismatch');
    for (let i = 0; i < o.data.length; i++) this.terrain[i] = +o.data[i];
    this.resetSoil();
    this.rebuildLists();
  },

  // ---- time ----
  season(tick) { return Math.floor(tick / P.seasonLength) % 2; },            // 0 boom, 1 bust
  seasonProgress(tick) { return (tick % P.seasonLength) / P.seasonLength; },
  darkness(tick) {                                                           // 0 noon .. 1 midnight
    const t = (tick % P.dayLength) / P.dayLength;
    return clamp(-Math.cos(2 * Math.PI * t) * 1.5 + 0.25, 0, 1);
  },
  isNight(tick) { return this.darkness(tick) > 0.5; },
};

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
