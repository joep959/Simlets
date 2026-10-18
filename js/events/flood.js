'use strict';
// Flood event: a spring flood that drowns the lowlands around a water body, then leaves them fertile (Nile style).
//
// Shape: every land tile in the region gets a flood level = how far the water must reach before it goes under:
//   level = distance to water (World.waterDist) + smooth noise (World.iceNoise, shifted per flood) so edges look natural
//   taper = 1 within half the radius of the centre, easing to 0 at the radius (so the region has no hard circle)
//   flood level = level / taper (tiles above the peak never flood)
// The water's reach rises fast (sin over the first 35% of the duration) to the peak, then recedes slowly (cos).
// Candidates are sorted by flood level once at the start, so the flooded tiles are always a prefix of that list: each tick
// only the tiles crossing the waterline are touched (no full-map loops).
//
// Going under: plants and crops on the tile spoil (their nutrients go back into the soil, as when they rot), and a
// shelter there loses its whole store and FLOOD_SHELTER_HIT health. While under: nothing grows (framework), simlets
// wade (World.wet: half speed, water cost), and every 25 ticks anything that landed there (crops, granary) spoils.
// Draining: the tile gains silt (+floodSilt soil, up to 1) and saplings drown (tree cover cleared unless the tile
// is established forest). The land system re-derives the tile types within 100 ticks, so silted land turns fertile.
//
// Automatic floods wait for the thaw: a roll outside it is remembered (Flood.pending) and the flood starts at the
// next thaw (the last 10% of bust or the first 10% of boom), around a random shore; at most one per thaw.
// Energy: floods only destroy food energy (spoiled plants, crops and stores); silt is soil nutrients, not energy.

const FLOOD_SHELTER_HIT = 0.3;  // shelter health lost when its tile goes under (0..1; repaired by building work)
const FLOOD_NOISE = 0.8;        // amplitude of the edge noise, in tiles of reach

defineEvent({
  key: 'flood', every: 6000, name: 'Flood', color: '#3fa0e8', needsPoint: true,
  tip: 'Rivers and lakes near a point burst their banks: the water rises over the low land (up to Flood peak reach tiles from the shore, within Flood radius of the point), then slowly recedes. Flooded land grows nothing, its plants, crops and shelter stores spoil, shelters there lose 30% health, and simlets wade (half speed, water cost). As each tile drains it gains silt (Flood silt) and its saplings drown, so the floodplain comes back fertile. Nothing happens if there is no water within reach. Automatic floods wait for the next thaw (last 10% of bust or first 10% of boom), so at most one a year, around a random shore.',
  params: [
    ['Flood', 'floodPeak',     'Flood peak reach (tiles)', 1,  10,   0.5,  4],
    ['Flood', 'floodDuration', 'Flood duration (ticks)',   300, 4000, 100, 1200],
    ['Flood', 'floodRadius',   'Flood radius (tiles)',     10, 250,  5,    40],
    ['Flood', 'floodSilt',     'Flood silt (soil per tile)', 0, 1,   0.05, 0.3],
  ],
  tips: {
    floodPeak: 'How far inland the water reaches at its height, in tiles from the shore (edges vary by up to about ±1 tile of smooth noise). The water rises over the first 35% of the flood and recedes over the rest. Taken when a flood starts.',
    floodDuration: 'Ticks from the first tile going under to the last one draining. Taken when a flood starts.',
    floodRadius: 'Size of the flooded region around the clicked point (automatic floods: a random shore). Full reach within half this distance, tapering to nothing at it. 250 = the whole map. Taken when a flood starts.',
    floodSilt: 'Soil nutrients each flooded tile gains as it drains (soil is capped at 1; above its normal level it leaches back slowly). Land turns fertile at soil 0.75.',
  },
  causes: {},
  autoOpts() { return {}; },    // no random point here: start() picks a shore (and only once the thaw comes)

  start(ev, opts) {
    if (ev.auto && !opts.thaw) { Flood.pending = true; return false; }   // wait for the thaw (Flood system below)
    if (ev.x == null) {                                                    // automatic: a random shore tile
      const L = World.landTiles; let ti = -1;
      for (let k = 0; k < 60 && L.length; k++) { const c = L[(Math.random() * L.length) | 0]; if (World.waterDist[c] <= 2) { ti = c; break; } }
      if (ti < 0) return false;
      ev.x = ti % WORLD_W + 0.5; ev.y = ((ti / WORLD_W) | 0) + 0.5;
    }
    ev.peak = P.floodPeak; ev.dur = P.floodDuration; ev.R = P.floodRadius;
    ev.ox = (Math.random() * WORLD_W) | 0; ev.oy = (Math.random() * WORLD_H) | 0;   // which part of the noise to use
    ev.stats = { flooded: 0, spoiled: 0, shelters: 0, silted: 0 };
    Flood.build(ev);
    if (!ev.n) return false;                                               // no water nearby: nothing to flood
    Events.note(ev, `rising: up to ${ev.peak} tiles from the shore, ${ev.n} tiles at risk`);
  },

  update(ev, tick) {
    const u = (tick - ev.start) / ev.dur;
    if (u >= 1) return false;
    const reach = ev.peak * (u < 0.35 ? Math.sin(Math.PI / 2 * u / 0.35) : Math.cos(Math.PI / 2 * (u - 0.35) / 0.65));
    const order = ev.order, lv = ev.levels;
    while (ev.k < ev.n && lv[ev.k] <= reach) Flood.flood(ev, order[ev.k++]);
    while (ev.k > 0 && lv[ev.k - 1] > reach) Flood.drain(ev, order[--ev.k]);
    if (tick % 25 === 0) for (let j = 0; j < ev.k; j++) Flood.spoil(ev, order[j], false);   // crops sown or gathered since
    if (tick % 100 === 0) Events.note(ev, `${u < 0.35 ? 'rising' : 'receding'}: ${ev.k} tiles under water` + Flood.summary(ev));
  },

  end(ev) {
    while (ev.k > 0) Flood.drain(ev, ev.order[--ev.k]);
    Events.note(ev, `${ev.stats.flooded} tiles flooded` + Flood.summary(ev));
  },

  describe(s, ev) {
    const i = (s.y | 0) * WORLD_W + (s.x | 0);
    return World.flood[i] ? 'Wading in floodwater' : '';
  },

  save(ev) { return { x: ev.x, y: ev.y, peak: ev.peak, dur: ev.dur, R: ev.R, ox: ev.ox, oy: ev.oy, stats: ev.stats }; },
  load(ev, d) {
    Object.assign(ev, { peak: d.peak, dur: d.dur, R: d.R, ox: d.ox, oy: d.oy, stats: d.stats });
    Flood.build(ev);
    // the saved noise is rounded, so flood levels may differ a hair: put the tiles that are under water (World.flood, saved
    // with the world) first, keeping flood-level order within each group, so the prefix rule still holds
    const under = [], dry = [], ku = [], kd = [];
    for (let j = 0; j < ev.n; j++) { const i = ev.order[j]; if (World.flood[i]) { under.push(i); ku.push(ev.levels[j]); } else { dry.push(i); kd.push(ev.levels[j]); } }
    ev.order = Int32Array.from(under.concat(dry)); ev.levels = Float32Array.from(ku.concat(kd)); ev.k = under.length;
  },
});

const Flood = {
  pending: false,               // an automatic flood was rolled: start one at the next thaw
  lastThaw: -1,                 // which thaw (nearest year boundary) the last automatic flood started in

  // the region's candidate tiles, sorted by the reach at which each goes under
  build(ev) {
    const W = WORLD_W, H = WORLD_H, wd = World.waterDist, nz = World.iceNoise, L = World.landTiles;
    const whole = ev.R >= 250, R = ev.R, cand = [];
    for (let k = 0; k < L.length; k++) {
      const i = L[k];
      if (wd[i] > ev.peak + 2) continue;                                   // too high to ever flood (noise is under ±1.2)
      const x = i % W, y = (i / W) | 0;
      let taper = 1;
      if (!whole) {
        const t = Math.hypot(x + 0.5 - ev.x, y + 0.5 - ev.y) / R;
        if (t >= 1) continue;
        if (t > 0.5) { const v = (t - 0.5) * 2; taper = 1 - v * v * (3 - 2 * v); }
      }
      const n = nz ? nz[((y + ev.oy) % H) * W + (x + ev.ox) % W] : 0;
      const level = Math.max(0.5, wd[i] + FLOOD_NOISE * n);
      const fl = taper > 0 ? level / taper : 1e9;
      if (fl <= ev.peak) cand.push([fl, i]);
    }
    cand.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    ev.n = cand.length; ev.k = 0;
    ev.order = Int32Array.from(cand, c => c[1]); ev.levels = Float32Array.from(cand, c => c[0]);
  },

  // a tile goes under: plants and crops spoil, a shelter's store spoils and it takes damage
  flood(ev, i) {
    World.setFlood(i, true); ev.stats.flooded++;
    this.spoil(ev, i, true);
  },
  spoil(ev, i, first) {
    if (Food.tileCount[i]) {
      const cx = i % WORLD_W + 0.5, cy = ((i / WORLD_W) | 0) + 0.5;
      Food.query(cx, cy, 1, f => {
        if (f.removed || f.type === 2 || Food.tileIndex(f) !== i) return;
        // rotting gives back nutrients as in Sim.rotFood; the food's energy is lost
        World.addNutrients(f.x, f.y, f.type === 0 ? P.plantSoil * f.e / P.plantEnergy : f.e * SOIL_PER_ENERGY);
        ev.stats.spoiled += f.e; Food.remove(f);
      });
    }
    const sh = Shelters.tiles.get(i);
    if (sh) {
      if (sh.store > 0) { ev.stats.spoiled += sh.store; World.addNutrients(sh.x, sh.y, sh.store * SOIL_PER_ENERGY); sh.store = 0; }
      if (first) { sh.health -= FLOOD_SHELTER_HIT; ev.stats.shelters++; }   // collapses at the next shelter update if <= 0
    }
  },
  // the water leaves: silt enriches the soil, saplings have drowned
  drain(ev, i) {
    World.setFlood(i, false);
    if (World.terrain[i] === TERRAIN.WATER) return;                        // painted over with water meanwhile
    if (P.floodSilt > 0 && World.soil[i] < 1) World.setSoil(i, World.soil[i] + P.floodSilt);
    if (!TERRAIN_INFO[World.terrain[i]].forest && World.trees[i] > 0) World.clearTrees(i);
    ev.stats.silted++;
  },
  summary(ev) {
    const s = ev.stats;
    return `, ${Math.round(s.spoiled)} food energy spoiled` + (s.shelters ? `, ${s.shelters} shelter tiles hit` : '') + (s.silted ? `, ${s.silted} tiles silted` : '');
  },

  // the thaw: the last 10% of bust or the first 10% of boom (snowmelt)
  thaw(tick) { const p = World.seasonProgress(tick); return World.season(tick) === 1 ? p >= 0.9 : p < 0.1; },
  update(tick) {
    if (!this.pending || !this.thaw(tick)) return;
    const id = Math.round(tick / (2 * P.seasonLength));                    // one automatic flood per thaw
    if (id === this.lastThaw || Events.isActive('flood')) return;          // keep waiting for the next one
    this.pending = false; this.lastThaw = id;
    Events.trigger('flood', { auto: true, thaw: true });
  },
};
registerSystem({ name: 'flood', phase: 'post', every: 25,
  update: tick => Flood.update(tick), reset: () => { Flood.pending = false; Flood.lastThaw = -1; },
  save: () => ({ pending: Flood.pending, lastThaw: Flood.lastThaw }),
  load: o => { Flood.pending = !!(o && o.pending); Flood.lastThaw = o && o.lastThaw != null ? o.lastThaw : -1; } });
