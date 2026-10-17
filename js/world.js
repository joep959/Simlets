'use strict';
// Terrain grid, food storage, seasons and day/night.

const World = {
  terrain: new Uint8Array(WORLD_W * WORLD_H),
  fertileTiles: [],
  grassTiles: [],
  forestTiles: [],
  shoreDist: new Float32Array(WORLD_W * WORLD_H),   // water tiles: distance to nearest land (tiles)
  ice: new Uint8Array(WORLD_W * WORLD_H),           // 1 = frozen water
  iceTiles: [],                                      // frozen tile indices (for drawing)
  iceNoise: null,
  scent: new Float32Array(WORLD_W * WORLD_H),       // plant-eater scent per tile (fades over time)
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
    this.fertileTiles = []; this.grassTiles = []; this.forestTiles = [];
    for (let i = 0; i < this.terrain.length; i++) {
      if (this.terrain[i] === TERRAIN.FERTILE) this.fertileTiles.push(i);
      else if (this.terrain[i] === TERRAIN.GRASS) this.grassTiles.push(i);
      else if (this.terrain[i] === TERRAIN.FOREST) this.forestTiles.push(i);
    }
    this.computeShoreDistance();
    this.updateIce(typeof Sim !== 'undefined' ? Sim.tick : 0);   // recompute, don't clear: shelters change terrain mid-winter
    this.dirty = true;
  },

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

  // open (unfrozen) water at a position: what actually slows and costs a simlet
  wet(x, y) {
    const tx = x | 0, ty = y | 0;
    if (tx < 0 || ty < 0 || tx >= WORLD_W || ty >= WORLD_H) return true;
    const i = ty * WORLD_W + tx;
    return this.terrain[i] === TERRAIN.WATER && !this.ice[i];
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
  freshSoil(ti) { const t = this.terrain[ti]; return (t === TERRAIN.FERTILE || t === TERRAIN.GRASS) && this.soil[ti] >= SOIL_MIN && !Shelters.tiles.has(ti); },

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
