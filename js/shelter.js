'use strict';
// Shelters: tiles built cooperatively by relatives. A finished shelter tile houses up to SHELTER_CAP relatives
// (very low drain, no winter cold, hidden from predators) and works as a granary: ripe crops within 3 tiles are
// pulled into its store, where they never rot, and relatives can eat from it. Shelters grow by adding
// neighbouring tiles. Unworked foundations crumble; finished shelters decay slowly (much slower while occupied)
// and finally collapse into fertile ruins. Building in forest clears the trees, so villages cause deforestation.

const SHELTER_CAP = 2;        // occupants per shelter tile
const STORE_CAP = 80;         // stored crop energy per shelter tile
const KIN_SIM = 0.6;          // genome similarity to the founder needed to use or work on a shelter
const SHELTER_R = 12;         // how far a simlet will look for its family's shelters (tiles)
const BUILD_SESSION = 40;     // ticks per work session
const NEW_SITE_GAP = 10;      // won't start a brand-new shelter within this many tiles of a relative's shelter
const FOUNDATION_DECAY = 2000;   // ticks for an untouched foundation to crumble away completely

const Shelters = {
  tiles: new Map(),           // tile index -> shelter tile
  ruins: new Map(),           // tile index -> tick it collapsed (drawn as rubble for a while)
  started: 0, finished: 0, crumbled: 0, collapsed: 0,

  reset() { this.tiles.clear(); this.ruins.clear(); this.started = this.finished = this.crumbled = this.collapsed = 0; },

  buildable(ti) {
    const t = World.terrain[ti];
    return (t === TERRAIN.GRASS || t === TERRAIN.FERTILE || t === TERRAIN.FOREST) && !this.tiles.has(ti);
  },
  isKin(s, sh) { return similarity(s.g, sh.owner) >= KIN_SIM; },

  // nearest shelter tile within SHELTER_R that passes pred() and belongs to s's family
  nearestKin(s, pred, r = SHELTER_R) {
    let best = null, bd = r;
    for (const sh of this.tiles.values()) {
      const d = Math.hypot(sh.x - s.x, sh.y - s.y);
      if (d < bd && pred(sh) && this.isKin(s, sh)) { bd = d; best = sh; }
    }
    return best ? { sh: best, d: bd } : null;
  },

  // Where should s work? 1) a family foundation or damaged shelter nearby, 2) extend a family shelter,
  // 3) start a new one where it stands, but only if the family has no shelter close by (join before you start)
  findSite(s) {
    const fix = this.nearestKin(s, sh => !sh.done || sh.health < 0.8, NEW_SITE_GAP);
    if (fix) return { ti: fix.sh.ti, x: fix.sh.x, y: fix.sh.y };
    const fam = this.nearestKin(s, sh => sh.done, NEW_SITE_GAP);
    if (fam) {
      const tx = fam.sh.ti % WORLD_W, ty = (fam.sh.ti / WORLD_W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = tx + dx, ny = ty + dy;
        if (nx < 0 || ny < 0 || nx >= WORLD_W || ny >= WORLD_H) continue;
        const ni = ny * WORLD_W + nx;
        if (this.buildable(ni)) return { ti: ni, x: nx + 0.5, y: ny + 0.5 };
      }
      return null;                              // family shelter here but no room to grow: don't scatter
    }
    const here = (s.y | 0) * WORLD_W + (s.x | 0);
    return this.buildable(here) ? { ti: here, x: (s.x | 0) + 0.5, y: (s.y | 0) + 0.5 } : null;
  },

  // timber: building in or next to forest is cheaper
  costFactor(ti) {
    const tx = ti % WORLD_W, ty = (ti / WORLD_W) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = tx + dx, ny = ty + dy;
      if (nx >= 0 && ny >= 0 && nx < WORLD_W && ny < WORLD_H && World.terrain[ny * WORLD_W + nx] === TERRAIN.FOREST) return 0.6;
    }
    return 1;
  },
  sessionCost(ti) { return P.buildCost / 4 * this.costFactor(ti); },

  // one work session: pay energy, add progress (4 sessions finish a tile); on a finished tile it repairs instead
  work(s, site, tick) {
    let sh = this.tiles.get(site.ti);
    const cost = this.sessionCost(site.ti);
    if (s.energy < cost * 1.2) return false;
    if (!sh) {
      if (!this.buildable(site.ti)) return false;
      sh = { ti: site.ti, x: site.x, y: site.y, owner: new Float32Array(s.g), progress: 0, done: false,
             health: 1, store: 0, occ: 0, lastWork: tick, lastUsed: tick };
      this.tiles.set(site.ti, sh); this.started++;
    }
    s.energy -= cost; sh.lastWork = tick; s.built = (s.built || 0) + 1;
    if (!sh.done) {
      sh.progress += 0.25;
      if (sh.progress >= 0.999) {
        sh.done = true; sh.progress = 1; sh.health = 1; this.finished++;
        if (World.terrain[sh.ti] === TERRAIN.FOREST) { World.terrain[sh.ti] = TERRAIN.GRASS; World.rebuildLists(); }  // trees felled
      }
    } else sh.health = Math.min(1, sh.health + 0.25);
    return true;
  },

  countOccupants(simlets) {
    for (const sh of this.tiles.values()) sh.occ = 0;
    for (const s of simlets) {
      if (!s.inShelter) continue;
      if (!this.tiles.has(s.inShelter.ti) || s.action !== 'shelter') { s.inShelter = null; continue; }
      s.inShelter.occ++;
    }
  },

  // every 25 ticks: decay, collapse into ruins, granary collection
  update(tick) {
    let terrainChanged = false;
    for (const sh of [...this.tiles.values()]) {
      if (!sh.done) {
        if (tick - sh.lastWork > 300) sh.progress -= 25 / FOUNDATION_DECAY;
        if (sh.progress <= 0) { this.tiles.delete(sh.ti); this.crumbled++; }
        continue;
      }
      if (sh.occ > 0) sh.lastUsed = tick;
      sh.health -= 25 / P.shelterLife * (sh.occ > 0 ? 0.1 : 1);
      if (sh.health <= 0) {                     // collapse: rubble on rich soil (any trees are long gone)
        this.tiles.delete(sh.ti); this.ruins.set(sh.ti, tick); this.collapsed++;
        World.terrain[sh.ti] = TERRAIN.FERTILE; World.setSoil(sh.ti, 1); terrainChanged = true;
        continue;
      }
      if (sh.store < STORE_CAP) Food.query(sh.x, sh.y, 3, f => {     // granary: ripe crops nearby are gathered in
        if (sh.store >= STORE_CAP || f.removed || f.type !== 1 || f.ready > tick) return;
        if (Math.hypot(f.x - sh.x, f.y - sh.y) > 3) return;
        const take = Math.min(f.e, STORE_CAP - sh.store);
        sh.store += take; f.e -= take;
        if (f.e <= 0.01) Food.remove(f);
      });
    }
    for (const [ti, t] of this.ruins) if (tick - t > 8000) this.ruins.delete(ti);
    if (terrainChanged) World.rebuildLists();
  },
};
