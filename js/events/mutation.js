'use strict';
// Radiation leak (mutation storm): a burst of genetic variety around a point, to shake up monocultures and seed new
// species. Children conceived near the leak get a higher mutation rate and bigger mutations (genes, and brain
// weights in Hybrid mode). Strength k = space × time: space = 1 - (d/R)² (full at the centre, 0 at the edge,
// half on average over the disc); time = 1 for the first half of the leak, then falling linearly to 0 at the end. No energy is touched: it only changes the mutation numbers
// that Sim.breed uses (the 'mutation' hook), so energy conservation is unaffected.
//
// Marking: the hook only sees the parents, so it records parent a's id; on the next tick (events run before the
// simlets, and the newborns still have age 0) every age-0 simlet whose first parent is on that list gets
// s.fx.mutant = the strength it was conceived at (0..1). The inspector shows "Mutant" while the leak is active;
// end() clears the marks.

// time part of the leak's strength: full for the first half, then a linear fade to 0 at the end
function radiationTimeFade(ev) { return clamp(2 * (1 - (Sim.tick - ev.start) / ev.dur), 0, 1); }

defineEvent({
  key: 'mutation', every: 60000, name: 'Radiation', color: '#e45aa8', needsPoint: true,
  tip: 'A radiation leak at a point (a click, or near a random simlet when automatic). For the leak\'s duration, children conceived within its radius get a higher mutation rate and bigger mutations (genes, and brain weights in Hybrid mode), strongest at the centre, fading to normal at the edge, and fading out over the second half of the leak. Brings genetic variety and new species; more of these oddballs die young than usual. Its sliders (Radiation section) are read when a leak starts.',
  params: [
    ['Radiation', 'mutRadius',   'Radius (tiles)',                   3,  50,    1,    30],
    ['Radiation', 'mutDuration', 'Duration (ticks)',               200, 12000, 100, 4000],
    ['Radiation', 'mutRateX',    'Mutation rate ×',                  1,  10,  0.5,    6],
    ['Radiation', 'mutSizeX',    'Mutation size ×',                  1,   5,  0.1,    3],
  ],
  tips: {
    mutRadius: 'How far the leak reaches, in tiles. A parent breeding inside it passes the extra mutation to its whole litter; the boost is full at the centre and falls off (1 - (distance/radius)²) to none at the edge.',
    mutDuration: 'How long a leak lasts, in ticks (a year is 6,000). It runs at full strength for the first half, then fades linearly to nothing at the end.',
    mutRateX: 'How much more often each gene (and each brain weight, in Hybrid mode) mutates in a child conceived at the centre while the leak is at full strength. Elsewhere it is 1 + (this - 1) × strength, strength being the distance and time fall-off. Capped at 0.5 per gene, the top of the Mutation rate slider.',
    mutSizeX: 'How much bigger each mutation is (gene and brain-weight nudges) at the centre while the leak is at full strength, scaled down the same way as the rate. Capped at 0.3 for genes and 1 for brain weights (the tops of the Mutation size and Brain mutation size sliders).',
  },

  // automatic leaks happen where simlets are: at a random living simlet (so a crowded area is the likeliest site)
  autoOpts() {
    const L = Sim.simlets;
    if (!L.length) { const [x, y] = Sim.randomLand(); return { x, y }; }
    const s = L[(Math.random() * L.length) | 0];
    return { x: s.x, y: s.y };
  },

  start(ev, opts) {
    ev.r = P.mutRadius; ev.dur = P.mutDuration; ev.rateX = P.mutRateX; ev.sizeX = P.mutSizeX;   // fixed at the start
    ev.parents = [];            // ids of parents (a) that bred in the zone this tick: their newborns get marked next tick
    ev.strength = [];           // the boost strength (0..1) each of those litters was conceived at
    ev.litters = 0; ev.mutants = 0;
    Events.note(ev, `radius ${ev.r}, ${ev.dur} ticks, rate ×${ev.rateX}, size ×${ev.sizeX}`);
  },

  update(ev, tick) {
    if (ev.parents.length) {                                   // mark last tick's newborns (age 0, first parent listed)
      const L = Sim.simlets;
      for (let i = L.length - 1; i >= 0; i--) {
        const s = L[i];
        if (s.age !== 0 || !s.parents.length) continue;
        const k = ev.parents.indexOf(s.parents[0]);
        if (k >= 0) { s.fx.mutant = ev.strength[k]; ev.mutants++; }
      }
      ev.parents.length = 0; ev.strength.length = 0;
    }
    if (tick % 100 === 0) Events.note(ev, `radius ${ev.r}, rate ×${ev.rateX}, size ×${ev.sizeX}: ${ev.mutants} mutant births from ${ev.litters} litters so far`);
    return tick - ev.start < ev.dur;
  },

  end(ev) {
    for (const s of Sim.simlets) if (s.fx.mutant !== undefined) delete s.fx.mutant;
    Events.note(ev, `radius ${ev.r}, rate ×${ev.rateX}, size ×${ev.sizeX}: ${ev.mutants} mutant births from ${ev.litters} litters`);
  },

  modify: {
    mutation(m, ctx, ev) {
      const dx = ctx.x - ev.x, dy = ctx.y - ev.y, d2 = dx * dx + dy * dy;
      if (d2 >= ev.r * ev.r) return m;
      const k = (1 - d2 / (ev.r * ev.r)) * radiationTimeFade(ev);
      if (k <= 0) return m;
      ev.litters++;
      ev.parents.push(ctx.a.id); ev.strength.push(Math.round(k * 100) / 100);
      const fr = 1 + (ev.rateX - 1) * k, fs = 1 + (ev.sizeX - 1) * k;
      return { rate: Math.min(0.5, m.rate * fr), size: Math.min(0.3, m.size * fs),
               brainRate: Math.min(0.5, m.brainRate * fr), brainSize: Math.min(1, m.brainSize * fs) };
    },
  },

  // a faint pulsing yellow-green glow over the zone, fading with the leak, and a thin ring at its edge
  draw(ctx, ev, R) {
    const [cx, cy] = R.toScreen(ev.x, ev.y), rad = ev.r * R.cam.zoom;
    if (cx + rad < 0 || cy + rad < 0 || cx - rad > R.w || cy - rad > R.h) return;
    const f = 0.35 + 0.65 * radiationTimeFade(ev);
    const pulse = 0.75 + 0.25 * Math.sin(performance.now() / 400);
    const a = 0.4 * f * pulse;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
    g.addColorStop(0, `rgba(235,245,90,${a.toFixed(3)})`);
    g.addColorStop(0.5, `rgba(170,230,60,${(a * 0.55).toFixed(3)})`);
    g.addColorStop(1, 'rgba(140,220,60,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, rad, 0, 7); ctx.fill();
    ctx.strokeStyle = `rgba(215,240,60,${(0.75 * f).toFixed(2)})`; ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.arc(cx, cy, rad, 0, 7); ctx.stroke(); ctx.setLineDash([]);
    const c = Math.max(3, R.cam.zoom * 0.8);                  // the leak itself: a small trefoil-ish dot
    ctx.fillStyle = `rgba(250,230,60,${(0.6 + 0.4 * pulse).toFixed(2)})`;
    ctx.beginPath(); ctx.arc(cx, cy, c, 0, 7); ctx.fill();
  },

  describe(s, ev) { return s.fx.mutant !== undefined ? 'Mutant' : ''; },

  save(ev) {
    return { r: ev.r, dur: ev.dur, rateX: ev.rateX, sizeX: ev.sizeX, litters: ev.litters, mutants: ev.mutants,
             parents: ev.parents.slice(), strength: ev.strength.slice() };
  },
  load(ev, d) {
    d = d || {};
    ev.r = d.r ?? P.mutRadius; ev.dur = d.dur ?? P.mutDuration; ev.rateX = d.rateX ?? P.mutRateX; ev.sizeX = d.sizeX ?? P.mutSizeX;
    ev.litters = d.litters || 0; ev.mutants = d.mutants || 0;
    ev.parents = d.parents || []; ev.strength = d.strength || [];
  },
});
