'use strict';
// Famine (drought): a hard lean spell that tests stores and thrift. While it lasts:
//  - wild food grows at famineSeverity × its usual rate on open land (grassland, fertile) and at famineForest × in
//    forest, through the 'spawn' hook (so it stacks with the bust season). Ramps in and out over FAMINE_RAMP ticks.
//  - the land dries: every 100 ticks open (non-forest) land loses famineDry soil, never below FAMINE_SOIL_FLOOR, so
//    fertile land turns to grassland and recovers only after the rains return (normal soil recovery, §9j).
//  - crops sown during it hold famineCrops × their energy (checked every 100 ticks; crops can't be eaten or stored
//    until 300 ticks after sowing, so none slips through).
// Nothing here creates energy: it only lowers spawn rates, soil and crop energy. Automatic famines never stack;
// triggering one while one is running extends the running one instead. The log notes duration and lowest population.

const FAMINE_RAMP = 300;          // ticks to ramp the shortage in at the start and out at the end
const FAMINE_SOIL_FLOOR = 0.5;    // drying never takes soil below this (so it never makes land dormant by itself)
const FAMINE_SCAN = 100;          // ticks between land-drying / crop checks

defineEvent({
  key: 'famine', name: 'Famine', color: '#d4a72c', needsPoint: false, every: 60000,
  tip: 'A drought: for about Famine length ticks (±25%) wild food on grassland and fertile land grows at Famine severity × its normal rate, forest at Forest food in famine ×, open land dries out (fertile land fades to grassland) and crops sown meanwhile hold less food. Shortage ramps in and out over 300 ticks. Stores and forests are the refuges. Triggering it while one is running extends that one.',
  params: [
    ['Famine', 'famineLength',   'Famine length (ticks)',          500, 20000, 250, 4500],
    ['Famine', 'famineSeverity', 'Open-land food in famine ×',     0,   1,     0.05, 0.3],
    ['Famine', 'famineForest',   'Forest food in famine ×',        0,   1,     0.05, 0.75],
    ['Famine', 'famineDry',      'Soil dried per 100 ticks',       0,   0.1,   0.005, 0.03],
    ['Famine', 'famineCrops',    'Crop yield in famine ×',         0,   1,     0.05, 0.5],
  ],
  tips: {
    famineLength: 'Average length of a famine in ticks; each one lasts this ×0.75 to ×1.25 (random). A year is 6,000 ticks at default settings.',
    famineSeverity: 'Wild food growth on grassland and fertile land during a famine, as a multiple of normal (it also stacks with the bust season). 0 = nothing grows there; 1 = no shortage.',
    famineForest: 'Wild food growth in forest during a famine, as a multiple of normal. Keep it above Open-land food to make forests a refuge.',
    famineDry: 'Every 100 ticks of famine, grassland and fertile soil drops by this much (never below 0.5, so drought alone never makes land dormant). Fertile land needs soil 0.6 to stay fertile, so a long drought turns it to grassland; it comes back as soil recovers after the famine (Soil recovery time). Lower soil also means smaller harvests. Normal recovery fights it, so below about 0.02 it does little. 0 = no drying.',
    famineCrops: 'Crops sown during a famine hold this fraction of their normal food (on top of any harvest lost to dried soil). 1 = no extra loss.',
  },

  start(ev, opts) {
    const run = Events.active.find(e => e.key === 'famine');
    if (run) {                                  // one at a time: a second trigger extends the running famine
      run.until = Math.max(run.until, Sim.tick + Math.round(P.famineLength * (0.75 + 0.5 * Math.random())));
      noteFamine(run); return false;
    }
    ev.until = Sim.tick + Math.round(P.famineLength * (0.75 + 0.5 * Math.random()));
    ev.depth = 0;                               // 0..1: how much of the shortage applies now (ramp in / out)
    ev.startPop = ev.minPop = Sim.simlets.length; ev.minAt = Sim.tick;
    ev.cropFrom = Sim.tick;                     // crops sown from this tick on still need cutting
    ev.cropCut = 0;                             // crop energy withheld so far
    noteFamine(ev);
  },

  update(ev, tick) {
    if (tick >= ev.until) return false;
    const r = FAMINE_RAMP;
    ev.depth = Math.min(1, (tick - ev.start) / r, (ev.until - tick) / r);
    const n = Sim.simlets.length;
    if (n < ev.minPop) { ev.minPop = n; ev.minAt = tick; }
    if ((tick - ev.start) % FAMINE_SCAN === 0) {
      cutFamineCrops(ev, tick);
      if (P.famineDry > 0) {                    // the land dries (forest keeps its soil)
        const L = World.landTiles, soil = World.soil, T = World.terrain, d = P.famineDry * ev.depth;
        for (let k = 0; k < L.length; k++) {
          const ti = L[k];
          if (soil[ti] > FAMINE_SOIL_FLOOR && !TERRAIN_INFO[T[ti]].forest) World.setSoil(ti, Math.max(FAMINE_SOIL_FLOOR, soil[ti] - d));
        }
      }
      if ((tick - ev.start) % 500 === 0) noteFamine(ev);   // the log text, not every tick (it redraws the log)
    }
  },

  end(ev) { cutFamineCrops(ev, Sim.tick); noteFamine(ev, true); },

  modify: {
    spawn(mult, ctx, ev) {
      const k = TERRAIN_INFO[ctx.type].forest ? P.famineForest : P.famineSeverity;
      return mult * (1 - ev.depth * (1 - k));
    },
  },

  // a faint dry, dusty haze over the map, as strong as the shortage
  draw(ctx, ev, R) {
    if (ev.depth <= 0) return;
    const [x0, y0] = R.toScreen(0, 0), [x1, y1] = R.toScreen(WORLD_W, WORLD_H);
    ctx.fillStyle = `rgba(214, 160, 60, ${(0.13 * ev.depth).toFixed(3)})`;
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  },

  describe(s, ev) { return `Famine (food ×${(1 - ev.depth * (1 - P.famineSeverity)).toFixed(2)})`; },

  save(ev) { return { until: ev.until, depth: ev.depth, startPop: ev.startPop, minPop: ev.minPop, minAt: ev.minAt, cropFrom: ev.cropFrom, cropCut: ev.cropCut }; },
  load(ev, d) {
    d = d || {};
    ev.until = d.until ?? Sim.tick; ev.depth = d.depth ?? 0;
    ev.startPop = d.startPop ?? Sim.simlets.length; ev.minPop = d.minPop ?? Sim.simlets.length; ev.minAt = d.minAt ?? Sim.tick;
    ev.cropFrom = d.cropFrom ?? Sim.tick; ev.cropCut = d.cropCut ?? 0;
  },
});

// crops sown since the last check (born in [cropFrom, tick)) lose (1 - famineCrops) of their energy: destroyed, not moved
function cutFamineCrops(ev, tick) {
  const from = ev.cropFrom, keep = P.famineCrops;
  ev.cropFrom = tick;
  if (keep >= 1) return;
  Food.forEach(f => {
    if (f.type !== 1 || f.born < from || f.born >= tick) return;
    const cut = f.e * (1 - keep); f.e -= cut; ev.cropCut += cut;
  });
}

function noteFamine(ev, done) {
  const len = done ? `lasted ${Sim.tick - ev.start} ticks` : `planned ${ev.until - ev.start} ticks`;
  Events.note(ev, `Drought ${len}: open-land food ×${P.famineSeverity}, forest ×${P.famineForest}. ` +
    `Population ${ev.startPop} at the start, lowest ${ev.minPop} (tick ${ev.minAt}). Crop food lost: ${Math.round(ev.cropCut)}.`);
}
