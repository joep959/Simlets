'use strict';
// Fire event: a wildfire that starts in forest or scrub and spreads tree to tree. The natural check on the slow
// forest gain of the living land (DESIGN.md §9j). Everything about it lives in this file (see DESIGN.md §14).
//
// Each fire keeps a list of burning tiles. Every FIRE_STEP ticks a burning tile may ignite each of its 8 neighbours,
// with a chance from the neighbour's tree cover (fuel), its dryness and the season. A tile burns for a while, then
// goes out: its trees are gone and its soil gets an ash boost. Food on a burning tile is destroyed, simlets on it
// lose energy every tick, and shelters on it lose health. Burnt ground keeps a dark ash tint that fades (Fire.ash).

const FIRE_STEP = 15;            // ticks between spread steps
const FIRE_BURN = 40;            // ticks a tile burns, plus FIRE_BURN × its fuel (so 40..80 ticks)
const FIRE_MIN_FUEL = 0.1;       // tree cover below this doesn't carry the fire
const FIRE_HUT_FUEL = 0.5;       // a shelter (built or foundation) burns like half-cover scrub
const FIRE_HUT_DAMAGE = 0.3;     // shelter health (or foundation progress) lost per spread step while burning
const FIRE_DIAG = 0.7;           // diagonal neighbours catch at this fraction of the chance
const FIRE_WET_FLOOR = 0.25;     // spread chance × on the wettest land (beside water); 1 on the driest
const FIRE_BUST_SPREAD = 0.5;    // spread chance × in bust (the cold wet season)
const FIRE_BUST_START = 0.25;    // share of automatic ignitions that take hold in bust (all of them in boom)
const FIRE_ASH_MIN = 0.2;        // soil boost from ash: FIRE_ASH_MIN + FIRE_ASH_FUEL × fuel (0.2..0.4)
const FIRE_ASH_FUEL = 0.2;
const FIRE_ASH_FADE = 4000;      // ticks the ash tint takes to fade

// shared fire map: which tiles are burning right now (any fire), and the burn scars (tile -> tick it went out)
const Fire = {
  burning: new Uint8Array(WORLD_W * WORLD_H),
  alight: 0,                     // how many tiles are burning now: simlets only look for fire while this is > 0
  ash: new Map(),

  fuel(i) {
    const t = World.trees[i];
    const f = Shelters.tiles.has(i) ? Math.max(t, FIRE_HUT_FUEL) : t;
    return f >= FIRE_MIN_FUEL ? f : 0;
  },
  // can a fire reach this tile at all? (land, not flooded, not already burning)
  canBurn(i) { return World.terrain[i] !== TERRAIN.WATER && !World.flood[i] && !this.burning[i]; },

  ignite(ev, i, tick) {
    const f = this.fuel(i);
    this.burning[i] = 1; this.alight++; ev.burnt.add(i);
    ev.tiles.push([i, tick + Math.round(FIRE_BURN * (1 + f)), f]);
    this.burnFood(i, true);
  },
  // food on a burning tile is destroyed (plants and crops; corpses too when the tile first catches)
  burnFood(i, corpses) {
    const tx = i % WORLD_W, ty = (i / WORLD_W) | 0, gone = [];
    Food.query(tx + 0.5, ty + 0.5, 0.5, f => { if ((f.x | 0) === tx && (f.y | 0) === ty && (corpses || f.type !== 2)) gone.push(f); });
    for (const f of gone) Food.remove(f);
  },
  // the tile goes out: trees gone, ash feeds the soil (may go above what moisture supports; it leaches back)
  burnOut(i, fuel, tick) {
    if (this.burning[i]) { this.burning[i] = 0; this.alight--; }
    World.clearTrees(i);
    World.setSoil(i, World.soil[i] + FIRE_ASH_MIN + FIRE_ASH_FUEL * fuel);
    this.ash.set(i, tick);
  },

  // ash scars, drawn under every event overlay (they outlast the fire that made them)
  drawAsh(ctx, R) {
    if (!this.ash.size) return;
    const z = R.cam.zoom, tick = Sim.tick;
    for (const [i, t] of this.ash) {
      const k = 1 - (tick - t) / FIRE_ASH_FADE; if (k <= 0) continue;
      const [px, py] = R.toScreen(i % WORLD_W, (i / WORLD_W) | 0);
      if (px < -z || py < -z || px > R.w || py > R.h) continue;
      ctx.fillStyle = `rgba(34,30,28,${(0.7 * k).toFixed(2)})`;          // charcoal, fading
      ctx.fillRect(px, py, z + 0.5, z + 0.5);
    }
  },
};

defineEvent({
  key: 'fire', every: 15000, name: 'Fire', color: '#ef5b3c', needsPoint: true,
  tip: `A wildfire. Automatic fires start in a random forest tile (else scrub); in bust only ${FIRE_BUST_START * 100}% of them take hold, so they come mostly in the dry boom. The button lights one where you click. Every ${FIRE_STEP} ticks each burning tile may set its 8 neighbours alight: likelier the more trees they have, less on moist land near water and in bust; bare ground, water and floodwater stop it, and shelters burn like scrub. A tile burns ${FIRE_BURN}-${2 * FIRE_BURN} ticks, then its trees are gone and ash enriches its soil. Food on burning tiles is destroyed, simlets standing in it lose energy fast (they sense fire within 6 tiles and try to escape it), and shelters lose health until they collapse. Burnt ground stays dark for a while.`,
  params: [
    ['Fire', 'fireSpread', 'Fire spread chance',         0, 1,    0.01,  0.25],
    ['Fire', 'fireMax',    'Fire max size (tiles)',      50, 5000, 50,   1500],
    ['Fire', 'fireHeat',   'Fire damage (energy %/tick)', 0, 20,  0.5,   4],
  ],
  tips: {
    fireSpread: `Chance per ${FIRE_STEP}-tick step that a burning tile sets a neighbour alight, for full tree cover on the driest land in boom. Scaled by the neighbour's tree cover (below ${FIRE_MIN_FUEL} it won't burn), down to ×${FIRE_WET_FLOOR} beside water, ×${FIRE_BUST_SPREAD} in bust and ×${FIRE_DIAG} for diagonals. A tile burns for several steps, so each neighbour gets several tries.`,
    fireMax: 'Safety cap: a single fire stops catching new tiles once it has burnt this many. Most fires burn out well before it in patchy or moist forest.',
    fireHeat: 'Energy lost per tick, as a % of its maximum, by a simlet standing on a burning tile (also inside a shelter there). At 4% one dies in about 25 ticks if it stays put. Deaths count as Burned and leave a normal corpse.',
  },
  causes: { fire: 'Burned' },

  // automatic fires: a random forest tile, else a random tile with some scrub
  autoOpts() {
    const F = World.forestTiles, L = World.landTiles;
    let i = -1;
    if (F.length) i = F[(Math.random() * F.length) | 0];
    else for (let k = 0; k < 50 && L.length; k++) { const j = L[(Math.random() * L.length) | 0]; if (World.trees[j] >= 0.2) { i = j; break; } }
    return i < 0 ? { x: null, y: null } : { x: i % WORLD_W + 0.5, y: ((i / WORLD_W) | 0) + 0.5 };
  },

  start(ev, opts) {
    if (ev.x == null) return false;                                       // nothing to burn
    const tx = ev.x | 0, ty = ev.y | 0;
    if (tx < 0 || ty < 0 || tx >= WORLD_W || ty >= WORLD_H) return false;
    const i = ty * WORLD_W + tx;
    if (!Fire.canBurn(i)) return false;                                   // water, floodwater, already alight
    if (ev.auto && World.season(Sim.tick) === 1 && Math.random() >= FIRE_BUST_START) return false;   // damp winter: fizzles
    ev.tiles = []; ev.burnt = new Set(); ev.died = 0; ev.huts = 0;
    Fire.ignite(ev, i, Sim.tick);                                         // the spark catches even on bare ground
    Events.note(ev, 'Burning');
  },

  update(ev, tick) {
    // heat: every simlet standing on a burning tile loses energy each tick
    const B = Fire.burning, L = Sim.simlets, heat = P.fireHeat / 100;
    for (let k = 0; k < L.length; k++) {
      const s = L[k]; if (s.dead) continue;
      const i = (s.y | 0) * WORLD_W + (s.x | 0);
      if (!B[i]) continue;
      const d = heat * s.maxEnergy;
      s.energy -= d; s.fx.fire = (s.fx.fire || 0) + d;
      if (s.energy <= 0) { Sim.kill(s, 'fire'); ev.died++; }
    }
    if ((tick - ev.start) % FIRE_STEP !== 0) return true;

    // burn-outs, then spread from the tiles still burning
    let out = false;
    const still = [];
    for (const t of ev.tiles) { if (tick >= t[1]) { Fire.burnOut(t[0], t[2], tick); out = true; } else still.push(t); }
    ev.tiles = still;
    const bust = World.season(tick) === 1, base = P.fireSpread * (bust ? FIRE_BUST_SPREAD : 1);
    const n = still.length;
    for (let k = 0; k < n; k++) {
      const i = still[k][0], x = i % WORLD_W, y = (i / WORLD_W) | 0;
      const sh = Shelters.tiles.get(i);                                   // a hut in the flames
      if (sh) {
        const key = sh.done ? 'health' : 'progress', was = sh[key];
        sh[key] -= FIRE_HUT_DAMAGE;
        if (was > 0 && sh[key] <= 0) ev.huts++;                            // Shelters.update collapses / clears it
      }
      Fire.burnFood(i, false);
      if (ev.burnt.size >= P.fireMax) continue;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= WORLD_W || ny >= WORLD_H) continue;
        const j = ny * WORLD_W + nx;
        if (!Fire.canBurn(j) || ev.burnt.has(j)) continue;
        const f = Fire.fuel(j); if (!f) continue;
        const dry = clamp((1 - World.moist[j]) / (1 - MOIST_BASE), 0, 1);
        const p = base * f * (FIRE_WET_FLOOR + (1 - FIRE_WET_FLOOR) * dry) * (dx && dy ? FIRE_DIAG : 1);
        if (Math.random() < p && ev.burnt.size < P.fireMax) Fire.ignite(ev, j, tick);
      }
    }
    if (out) World.refreshLand();                                         // burnt forest turns to grass / fertile
    Events.note(ev, `${ev.burnt.size} tiles burnt${ev.tiles.length ? ` (${ev.tiles.length} alight)` : ''}` +
                    `${ev.died ? `, ${ev.died} burned to death` : ''}${ev.huts ? `, ${ev.huts} shelters lost` : ''}`);
    return ev.tiles.length > 0;
  },

  end(ev) {
    let out = false;                                                      // stopped early: put out what is still alight
    for (const t of ev.tiles) { if (Fire.burning[t[0]]) { Fire.burning[t[0]] = 0; Fire.alight--; } out = true; }
    ev.tiles = [];
    if (out) World.refreshLand();
    for (const s of Sim.simlets) if (s.fx.fire !== undefined) delete s.fx.fire;
  },

  draw(ctx, ev, R) {
    const z = R.cam.zoom, f = (performance.now() / 120) | 0;
    for (const t of ev.tiles) {
      const i = t[0], [px, py] = R.toScreen(i % WORLD_W, (i / WORLD_W) | 0);
      if (px < -z || py < -z || px > R.w || py > R.h) continue;
      const h = ((i * 2654435761 + f * 40503) >>> 0) % 100;              // per-tile flicker
      ctx.fillStyle = h < 40 ? 'rgba(255,120,30,0.85)' : h < 75 ? 'rgba(235,70,35,0.8)' : 'rgba(255,190,60,0.85)';
      ctx.fillRect(px, py, z + 0.5, z + 0.5);
      if (z >= 5) { ctx.fillStyle = 'rgba(255,240,170,0.9)'; ctx.fillRect(px + z * (0.2 + (h % 5) * 0.12), py + z * (0.15 + (h % 7) * 0.1), Math.max(1, z * 0.15), Math.max(1, z * 0.15)); }
    }
  },

  describe(s, ev) {
    if (Fire.burning[(s.y | 0) * WORLD_W + (s.x | 0)]) return 'In a fire!';
    return s.fx.fire ? `Burned (−${Math.round(s.fx.fire)} energy)` : '';
  },
  save(ev) { return { tiles: ev.tiles, burnt: [...ev.burnt], died: ev.died, huts: ev.huts }; },
  load(ev, d) {
    ev.tiles = d.tiles; ev.burnt = new Set(d.burnt); ev.died = d.died || 0; ev.huts = d.huts || 0;
    for (const t of ev.tiles) if (!Fire.burning[t[0]]) { Fire.burning[t[0]] = 1; Fire.alight++; }
  },
});

// ash scars outlast the fire, so they are kept, saved and pruned by a system of their own, and drawn under the
// event overlays (Events.draw only draws active events)
registerSystem({ name: 'fireAsh', phase: 'post', every: 500,
  update(tick) { for (const [i, t] of Fire.ash) if (tick - t >= FIRE_ASH_FADE) Fire.ash.delete(i); },
  reset() { Fire.ash.clear(); Fire.burning.fill(0); Fire.alight = 0; },
  save() { return [...Fire.ash]; },
  load(o) { Fire.ash = new Map(o); },
});
{
  const draw = Events.draw;
  Events.draw = function (ctx, R) { Fire.drawAsh(ctx, R); draw.call(this, ctx, R); };
}
