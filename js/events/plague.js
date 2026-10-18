'use strict';
// Plague: a disease that breaks up monocultures (frequency-dependent selection, the "Red Queen" effect).
// The strain is patient zero's genome. Every 25 ticks each sick simlet can infect simlets within PLAGUE_RANGE tiles,
// with chance plagueSpread × similarity(strain, host)² × (1 − 0.8 × resistance gene), so it races through dense,
// genetically similar herds and barely touches foreigners. Sick simlets pay extra idle drain and may die of it
// (cause 'disease'); survivors are immune for a while. The spread chance fades to 0 over PLAGUE_FADE ticks and the
// outbreak ends when nobody is sick. See DESIGN.md §14.
//
// Per-simlet state: s.fx.plague = { ev: event id, sick: tick it recovers } while sick, { imm: tick immunity ends } after.

const PLAGUE_RANGE = 4;         // tiles: contact distance for passing it on (1.5 gave R0 < 1 at normal densities)
const PLAGUE_CHECK = 25;        // ticks between transmission / death rolls
const PLAGUE_FADE = 6000;       // ticks (a year): the spread chance falls linearly to 0 by then, so an outbreak can't become
                                // endemic (newborns are never immune, and without this one ran for 18,000+ ticks)
const PLAGUE_SEEDS = 5;         // first cases: patient zero plus up to 4 close relatives in contact range

const Plague = {
  // reused by the transmission query (no closure allocated per sick simlet)
  ev: null, src: null, tick: 0, spread: 0,
  infect(ev, s, tick) {
    const len = P.plagueLength * (0.67 + 0.66 * Math.random());       // 0.67 .. 1.33 × the slider
    s.fx.plague = { ev: ev.id, sick: Math.round(tick + len) };
    ev.sick.push(s); ev.infected++;
    if (s.species && s.species.id === ev.sp) ev.spInfected++;
  },
  // query callback: one contact of the current sick simlet this.src
  contact(o) {
    const s = Plague.src, ev = Plague.ev;
    if (o === s || o.dead) return;
    if (o.inShelter !== s.inShelter) return;          // shelters: only housemates (same shelter) share it, walls keep it out
    const f = o.fx.plague;
    if (f && (f.sick || f.imm > Plague.tick)) return;   // already sick, or still immune
    const dx = o.x - s.x, dy = o.y - s.y;
    if (dx * dx + dy * dy > PLAGUE_RANGE * PLAGUE_RANGE) return;
    const sm = similarity(ev.strain, o.g);
    const p = Plague.spread * sm * sm * (1 - 0.8 * (o.g[G.resistance] || 0));
    if (Math.random() < p) Plague.infect(ev, o, Plague.tick);
  },
  label(ev) { return `species #${ev.sp}`; },
  report(ev) {
    const pct = ev.spStart ? Math.round(100 * ev.spDied / ev.spStart) : 0;
    Events.note(ev, `${this.label(ev)} (${ev.spStart} at start): ${ev.infected} infected, ${ev.died} died while sick ` +
                    `(${ev.diedDisease} of the disease); ${ev.spDied} deaths among the species while it ran (${pct}% of its starting size)` + (ev.sick.length ? `, ${ev.sick.length} sick now` : ''));
  },
};

defineEvent({
  key: 'plague', every: 48000, name: 'Plague', color: '#a77bf0', needsPoint: true,
  tip: 'A disease outbreak. Starts in one simlet (the one nearest the click; automatic outbreaks pick a crowded member of the largest species: the one with the most herd-mates close by, of 12 tried at random) plus up to 4 close relatives beside it, and spreads by close contact, mostly to simlets genetically similar to that first case. Sick simlets burn extra energy and may die; survivors become immune for a while (children are born without immunity). The strain weakens over a year, and the outbreak ends when nobody is sick. Sick simlets have a yellow-green ring.',
  params: [
    ['Plague', 'plagueSpread',   'Plague: spread chance',        0, 1,     0.01,  0.5],
    ['Plague', 'plagueLength',   'Plague: sickness length',      100, 3000, 50,   900],
    ['Plague', 'plagueDrain',    'Plague: extra drain',          0, 5,     0.1,   0.5],
    ['Plague', 'plagueDeath',    'Plague: death chance',         0, 0.1,   0.001, 0.006],
    ['Plague', 'plagueImmunity', 'Plague: immunity length',      0, 20000, 500,   5000],
  ],
  tips: {
    plagueSpread: `Every ${PLAGUE_CHECK} ticks, each sick simlet may infect each simlet within ${PLAGUE_RANGE} tiles with this chance × similarity² (genetic similarity of that simlet to the first case) × (1 − 0.8 × its Resistance gene). Close relatives of the first case catch it easily; other species almost never. Inside a shelter it only passes between housemates. The strain weakens with time: this chance falls linearly to zero ${PLAGUE_FADE} ticks after the outbreak began, so every outbreak ends.`,
    plagueLength: 'Average ticks a simlet stays sick (each case lasts 67% to 133% of this). Then it recovers and becomes immune.',
    plagueDrain: 'Extra energy drain while sick, as a multiple of its normal idle drain (0.5 = +50%), paid every tick even when resting or indoors. Can starve weak simlets (counted as Died: disease).',
    plagueDeath: `Chance of dying of the disease, rolled every ${PLAGUE_CHECK} ticks while sick (0.006 over a 900-tick illness kills about 20% of cases outright; the extra drain starves some more).`,
    plagueImmunity: 'Ticks a recovered simlet stays immune (cannot catch any plague). Its children are born without immunity.',
  },
  causes: { disease: 'Died: disease' },

  // automatic outbreaks start in the largest species (no point needed)
  autoOpts() { return { biggest: true }; },

  start(ev, opts) {
    const L = Sim.simlets; if (!L.length) return false;
    let p0 = null;
    if (opts.x != null && !opts.biggest) {                 // manual: the simlet nearest the click
      let bd = Infinity;
      for (const s of L) { if (s.dead) continue; const d = (s.x - opts.x) ** 2 + (s.y - opts.y) ** 2; if (d < bd) { bd = d; p0 = s; } }
    } else {                                               // automatic: a crowded member of the largest species
      let big = null; for (const sp of Species.live.values()) if (!big || sp.count > big.count) big = sp;
      if (!big || big.count < 10) return false;            // no herd worth an outbreak
      const m = L.filter(s => !s.dead && s.species === big);
      const ok = m.filter(s => !(s.fx.plague && s.fx.plague.imm > Sim.tick));
      const pool = ok.length ? ok : m; if (!pool.length) return false;
      // of up to 12 random members, the one with the most herd-mates in contact range (disease starts in a crowd)
      let best = -1;
      for (let k = 0; k < 12; k++) {
        const c = pool[(Math.random() * pool.length) | 0]; let n = 0;
        Sim.querySimlets(c.x, c.y, PLAGUE_RANGE, o => { if (o !== c && o.species === big && (o.x - c.x) ** 2 + (o.y - c.y) ** 2 <= PLAGUE_RANGE * PLAGUE_RANGE) n++; });
        if (n > best) { best = n; p0 = c; }
      }
    }
    if (!p0) return false;
    ev.x = p0.x; ev.y = p0.y;
    ev.strain = new Float32Array(p0.g);
    ev.sp = p0.species ? p0.species.id : 0;
    ev.spStart = p0.species ? p0.species.count : 0;
    ev.sick = []; ev.infected = 0; ev.spInfected = 0; ev.died = 0; ev.diedDisease = 0; ev.spDied = 0;
    Plague.infect(ev, p0, Sim.tick);
    // a small first cluster: up to PLAGUE_SEEDS - 1 close relatives near patient zero catch it too (a lone case
    // often died or recovered before passing it on, so many outbreaks fizzled at once)
    Sim.querySimlets(p0.x, p0.y, PLAGUE_RANGE, o => {
      if (ev.sick.length >= PLAGUE_SEEDS || o === p0 || o.dead || o.inShelter !== p0.inShelter) return;
      const f = o.fx.plague; if (f && (f.sick || f.imm > Sim.tick)) return;
      if ((o.x - p0.x) ** 2 + (o.y - p0.y) ** 2 <= PLAGUE_RANGE * PLAGUE_RANGE && similarity(ev.strain, o.g) >= 0.5) Plague.infect(ev, o, Sim.tick);
    });
    Plague.report(ev);
  },

  update(ev, tick) {
    const S = ev.sick, roll = (tick - ev.start) % PLAGUE_CHECK === 0;
    let w = 0;
    for (let i = 0; i < S.length; i++) {
      const s = S[i], f = s.fx.plague;
      if (s.dead || !f || f.ev !== ev.id || !f.sick) {     // died (any cause) or no longer ours
        if (s.dead && f && f.ev === ev.id) { ev.died++; if (s.cause === 'disease') ev.diedDisease++; if (s.species && s.species.id === ev.sp) ev.spDied++; }
        continue;
      }
      if (tick >= f.sick) { s.fx.plague = { imm: tick + P.plagueImmunity }; continue; }   // recovered
      s.energy -= P.idleCost * s.drainMult * P.plagueDrain;   // fever: energy is lost, not moved anywhere
      if (s.energy <= 0) { Sim.kill(s, 'disease'); S[w++] = s; continue; }
      if (roll && Math.random() < P.plagueDeath) { Sim.kill(s, 'disease'); S[w++] = s; continue; }
      S[w++] = s;
    }
    S.length = w;
    const fade = 1 - (tick - ev.start) / PLAGUE_FADE;         // the strain weakens: spread falls to 0 over PLAGUE_FADE ticks
    if (roll && P.plagueSpread > 0 && fade > 0) {
      Plague.ev = ev; Plague.tick = tick; Plague.spread = P.plagueSpread * fade;
      const n = S.length;                                   // new cases join the list but don't spread until the next roll
      for (let i = 0; i < n; i++) {
        const s = S[i]; if (s.dead) continue;
        Plague.src = s;
        Sim.querySimlets(s.x, s.y, PLAGUE_RANGE, Plague.contact);
      }
      Plague.src = null; Plague.ev = null;
    }
    if (tick % 100 === 0 || !S.length) Plague.report(ev);
    return S.length > 0;
  },

  // stopped early: anyone still sick with this strain is cured (no immunity)
  end(ev) {
    for (const s of ev.sick) { const f = s.fx.plague; if (f && f.ev === ev.id && f.sick) delete s.fx.plague; }
    ev.sick = [];
  },

  modify: {},

  draw(ctx, ev, R) {
    const z = R.cam.zoom;
    ctx.lineWidth = Math.max(1.5, z * 0.18);
    ctx.strokeStyle = 'rgba(190,230,60,0.95)'; ctx.fillStyle = 'rgba(167,123,240,0.30)';
    for (const s of ev.sick) {
      if (s.dead) continue;
      const [x, y] = R.toScreen(s.x, s.y), r = Math.max(4, (s.radius + 0.45) * z);
      if (x < -r || y < -r || x > R.w + r || y > R.h + r) continue;
      ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
    }
  },

  describe(s, ev) {
    const f = s.fx.plague; if (!f) return '';
    if (f.sick) return f.ev === ev.id ? `Sick (plague, ${Math.max(0, f.sick - Sim.tick)} ticks left)` : '';
    // immunity: say it once even if several outbreaks are running
    if (f.imm > Sim.tick && Events.active.find(e => e.key === 'plague') === ev) return `Immune to plague (${f.imm - Sim.tick} ticks left)`;
    return '';
  },

  save(ev) {
    return { strain: Array.from(ev.strain, v => Math.round(v * 1e4) / 1e4), sp: ev.sp, spStart: ev.spStart, infected: ev.infected,
             spInfected: ev.spInfected, died: ev.died, diedDisease: ev.diedDisease, spDied: ev.spDied };
  },
  load(ev, d) {
    ev.strain = Float32Array.from(d.strain);
    Object.assign(ev, { sp: d.sp, spStart: d.spStart, infected: d.infected, spInfected: d.spInfected, died: d.died, diedDisease: d.diedDisease, spDied: d.spDied });
    // the sick list is rebuilt from the simlets (their fx is saved with them)
    ev.sick = Sim.simlets.filter(s => s.fx.plague && s.fx.plague.ev === ev.id && s.fx.plague.sick);
  },
});
