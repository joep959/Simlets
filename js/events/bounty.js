'use strict';
// Bounty event: a mast year / bumper season, the opposite of famine. For a while every wild-food terrain grows more
// (through the 'spawn' hook, on top of the boom/bust multiplier), forest most of all, and at the start the forest
// drops a windfall of plants. All the extra energy enters as ordinary wild plants (Sim.spawnOn), so the usual limits
// still hold: the per-tile cap, dormant soil, shelters and floodwater grow nothing, and each plant draws soil
// nutrients. Nothing is given to simlets directly (energy conservation, DESIGN.md §4).
//
// Strength over time: ramps up over the first 10% of the event, holds, then fades over the last 30%, so the
// knock-on boom eases off instead of hitting a cliff. Settings are copied onto the event when it starts, so moving
// a slider affects the next bounty, not the running one (and a save holds exactly what is running).

const BOUNTY_RAMP_IN = 0.1, BOUNTY_RAMP_OUT = 0.3;   // shares of the event spent ramping up / fading out

// 0..1 strength at a tick
function bountyShape(ev, tick) {
  const f = (tick - ev.start) / ev.len;
  if (f < 0 || f >= 1) return 0;
  if (f < BOUNTY_RAMP_IN) return f / BOUNTY_RAMP_IN;
  if (f > 1 - BOUNTY_RAMP_OUT) return (1 - f) / BOUNTY_RAMP_OUT;
  return 1;
}
// spawn multiplier on a terrain type at full strength
function bountyPeak(ev, type) { return TERRAIN_INFO[type].forest ? ev.boost * ev.mast : ev.boost; }
// current spawn multiplier on a terrain type (1 = normal)
function bountyMult(ev, type, tick) { return 1 + (bountyPeak(ev, type) - 1) * bountyShape(ev, tick); }

defineEvent({
  key: 'bounty', name: 'Bounty', color: '#62cf72', needsPoint: false,
  tip: 'A bumper season (mast year): wild food grows faster everywhere for a while, forest food most, and the forest drops a windfall of plants at the start. It ramps up over the first 10% of the event and fades over the last 30%. The extra food is ordinary wild plants: tile cap, dormant soil and floods still limit it, and each plant still draws soil nutrients, so heavy growth can wear land out. Expect a breeding boom and then a crash when it ends.',
  params: [
    ['Bounty', 'bountyBoost',    'Food growth ×',            1, 5,     0.1, 2.5],
    ['Bounty', 'bountyMast',     'Extra × in forest (mast)', 1, 4,     0.1, 2],
    ['Bounty', 'bountyLength',   'Length (ticks)',         500, 10000, 500, 3000],
    ['Bounty', 'bountyWindfall', 'Forest windfall',          0, 1,     0.05, 0.25],
  ],
  tips: {
    bountyBoost: 'During a bounty, wild food grows this many times faster on every terrain, on top of the boom/bust season (so a bounty in bust softens the winter). Full strength in the middle of the event, ramping in and out at the ends.',
    bountyMast: 'Forest gets this extra multiplier on top of Food growth × (a mast year: trees fruit heavily). 2.5 × 2 = forest food grows 5 times faster at the peak.',
    bountyLength: 'How long a bounty lasts, in ticks (a year is 6,000 ticks at default settings). The first 10% ramps up, the last 30% fades out.',
    bountyWindfall: 'One-off drop when a bounty starts: about this many plants per forest tile fall at once (0.25 = one per four forest tiles), placed like normal wild plants (tile cap, dormant soil, shelters and floods still block them). 0 = no windfall.',
  },
  start(ev, opts) {
    ev.boost = opts.boost ?? P.bountyBoost; ev.mast = opts.mast ?? P.bountyMast;
    ev.len = Math.max(1, opts.len ?? P.bountyLength);
    ev.pop0 = Sim.simlets.length; ev.peak = ev.pop0;
    const before = Food.count;
    const wf = opts.windfall ?? P.bountyWindfall;
    if (wf > 0) Sim.spawnOn(World.forestTiles, wf);       // the windfall: real wild plants, same rules as spawning
    ev.windfall = Food.count - before;
    Events.note(ev, `food ×${ev.boost}, forest ×${+(ev.boost * ev.mast).toFixed(2)} for ${ev.len} ticks; windfall ${ev.windfall} plants; pop ${ev.pop0}`);
  },
  update(ev, tick) {
    const n = Sim.simlets.length; if (n > ev.peak) ev.peak = n;
    return tick - ev.start < ev.len;
  },
  end(ev) {
    Events.note(ev, `food ×${ev.boost}, forest ×${+(ev.boost * ev.mast).toFixed(2)}; windfall ${ev.windfall} plants; pop ${ev.pop0} → peak ${ev.peak} → ${Sim.simlets.length} at the end`);
  },
  modify: {
    spawn(mult, ctx, ev) { return mult * bountyMult(ev, ctx.type, Sim.tick); },
  },
  // inspector: the current food boost on the terrain this simlet stands on
  describe(s, ev) {
    const t = World.at(s.x, s.y);
    if (!TERRAIN_INFO[t] || !TERRAIN_INFO[t].spawnKey) return 'Bounty';
    return `Bounty: food ×${bountyMult(ev, t, Sim.tick).toFixed(1)} here`;
  },
  // map: a faint warm glow over wild-food land plus golden fruit specks, both strongest where the boost is biggest
  // (forest, by default), fading in and out with the event. Drawn from a small offscreen canvas (4 px per tile, the
  // specks at fixed hashed spots) that is rebuilt every 200 ticks, since land types change slowly.
  draw(ctx, ev, R) {
    const s = bountyShape(ev, Sim.tick); if (s <= 0) return;
    const SC = 4, W = WORLD_W * SC;
    if (!ev.glow) { ev.glow = document.createElement('canvas'); ev.glow.width = W; ev.glow.height = WORLD_H * SC; ev.glowAt = -1e9; }
    if (Sim.tick - ev.glowAt >= 200 || Sim.tick < ev.glowAt) {
      ev.glowAt = Sim.tick;
      const g = ev.glow.getContext('2d'), img = g.createImageData(W, WORLD_H * SC), d = img.data;
      const top = Math.max(...SPAWN_TYPES.map(t => bountyPeak(ev, t))) - 1 || 1;
      const px = (x, y, r, gg, b, a) => { const k = (y * W + x) * 4; d[k] = r; d[k + 1] = gg; d[k + 2] = b; d[k + 3] = a; };
      for (const t of SPAWN_TYPES) {
        const rel = (bountyPeak(ev, t) - 1) / top;                          // 0..1: share of the biggest boost
        if (rel <= 0) continue;
        const tint = Math.round(20 + 40 * rel), specks = rel > 0.6 ? 3 : 1;
        for (const ti of World.typeTiles[t]) {
          const tx = (ti % WORLD_W) * SC, ty = ((ti / WORLD_W) | 0) * SC;
          for (let y = 0; y < SC; y++) for (let x = 0; x < SC; x++) px(tx + x, ty + y, 255, 214, 90, tint);
          let h = Math.imul(ti, 2654435761) >>> 0;
          for (let k = 0; k < specks; k++) { px(tx + (h & 3), ty + ((h >>> 2) & 3), 255, 196, 40, 255); h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0; }
        }
      }
      g.putImageData(img, 0, 0);
    }
    const [ox, oy] = R.toScreen(0, 0), z = R.cam.zoom;
    ctx.save();
    ctx.globalAlpha = 0.9 * s; ctx.imageSmoothingEnabled = false;
    ctx.drawImage(ev.glow, ox, oy, WORLD_W * z, WORLD_H * z);
    ctx.restore();
  },
  save(ev) { return { boost: ev.boost, mast: ev.mast, len: ev.len, pop0: ev.pop0, peak: ev.peak, windfall: ev.windfall }; },
  load(ev, d) { Object.assign(ev, { boost: 2.5, mast: 2, len: 3000, pop0: 0, peak: 0, windfall: 0 }, d || {}); },
});
