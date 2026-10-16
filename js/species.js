'use strict';
// Species = genetic clusters, NEAT-style: each species keeps a representative genome; a simlet belongs
// to a species if it is at least P.speciesThreshold similar to that representative. Every update the
// representative is re-picked from a random living member, so species drift with their population and
// a population that drifts apart splits into new species.

const SPECIES_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
const OTHER_COLOR = '#8a8a84';
const SLOT_MIN = 8;            // a species needs this many members to earn one of the 8 colours

const Species = {
  live: new Map(),             // id -> species (living only, searched when assigning)
  meta: new Map(),             // id -> { slot } for every species ever seen (chart colours after extinction)
  nextId: 1,
  slots: new Array(SPECIES_COLORS.length).fill(null),
  extinctCount: 0,

  reset() {
    this.live.clear(); this.meta.clear(); this.nextId = 1; this.slots.fill(null); this.extinctCount = 0;
  },

  create(genome, parentId, tick) {
    const sp = { id: this.nextId++, rep: new Float32Array(genome), parent: parentId, born: tick,
                 count: 0, peak: 0, slot: -1, dietMean: 0, pick: null };
    this.live.set(sp.id, sp);
    this.meta.set(sp.id, sp);
    return sp;
  },

  // Keep s in its current species if still close enough, else join the closest one, else found a new one
  assign(s, tick) {
    const T = P.speciesThreshold, cur = s.species;
    if (cur && this.live.has(cur.id) && similarity(s.g, cur.rep) >= T) return;
    let best = null, bs = T;
    for (const sp of this.live.values()) { const v = similarity(s.g, sp.rep); if (v >= bs) { bs = v; best = sp; } }
    s.species = best || this.create(s.g, cur ? cur.id : null, tick);
  },

  update(simlets, tick) {
    for (const s of simlets) this.assign(s, tick);
    for (const sp of this.live.values()) { sp.count = 0; sp.dietSum = 0; sp.pick = null; }
    for (const s of simlets) {
      const sp = s.species;
      sp.count++; sp.dietSum += s.g[G.diet];
      if (Math.random() < 1 / sp.count) sp.pick = s;       // reservoir sample: uniform random member
    }
    for (const sp of [...this.live.values()]) {
      if (sp.count === 0) {                                // extinct: free its colour
        if (sp.slot >= 0) this.slots[sp.slot] = null;
        sp.extinct = tick; this.live.delete(sp.id); this.extinctCount++;
        continue;
      }
      sp.rep = new Float32Array(sp.pick.g);
      sp.peak = Math.max(sp.peak, sp.count);
      sp.dietMean = sp.dietSum / sp.count;
    }
    // hand free colours to the biggest uncoloured species; a species keeps its colour for life
    const waiting = [...this.live.values()].filter(sp => sp.slot < 0 && sp.count >= SLOT_MIN).sort((a, b) => b.count - a.count);
    for (const sp of waiting) {
      const free = this.slots.indexOf(null);
      if (free < 0) break;
      this.slots[free] = sp.id; sp.slot = free;
    }
  },

  color(sp) { return sp && sp.slot >= 0 ? SPECIES_COLORS[sp.slot] : OTHER_COLOR; },

  // compact snapshot for the history chart: [[id, count], ...] for living species
  snapshot() { return [...this.live.values()].map(sp => [sp.id, sp.count]); },
};
