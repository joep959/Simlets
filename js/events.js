'use strict';
// Random events (plague, fire, flood, famine, bounty, mutation...). Each event lives in its own file in js/events/
// and calls defineEvent() at load time. This file is the shared framework: definitions, sliders, automatic and
// manual triggering, the active list, the event log, hooks into the core (Events.modify), drawing, inspector status
// and save/load. It runs as a system in the 'post' phase of Sim.step (after immigration). See DESIGN.md §14.
//
// Determinism: with Automatic events off, or an event's frequency at 0, no random numbers are drawn for it, and
// with nothing active every hook returns its input unchanged, so a run is identical to one without events.

const EVENT_DEFS = [];          // definitions, in load order (= the order of the trigger buttons and auto checks)
const EVENT_BY_KEY = {};
const EVENT_LOG_MAX = 200;      // finished log entries kept (active ones are never dropped)

addParams([['Events', 'eventsOn', 'Automatic events (0 = off, 1 = on)', 0, 1, 1, 1]], {
  eventsOn: 'Master switch for random events happening by themselves (each at the rate set by its own "every" slider below). 0 = no automatic events. None happen in the first 6,000 ticks (a year), while the founders settle. The trigger buttons work either way.',
});

// def: { key, name, color, tip, needsPoint, every, params, tips, causes, start, update, end, modify, draw, describe, save, load }
// (see DESIGN.md §14 for each field). Adds the '<key>Every' frequency slider plus the event's own sliders.
const EVENT_GRACE = 6000;   // ticks: no automatic events in the first year, while the founders settle
function defineEvent(def) {
  if (EVENT_BY_KEY[def.key]) throw new Error('Event defined twice: ' + def.key);
  const d = Object.assign({ color: '#e6a23c', tip: '', needsPoint: false, every: 0, params: [], tips: {}, causes: {}, modify: {} }, def);
  EVENT_DEFS.push(d); EVENT_BY_KEY[d.key] = d;
  const fk = d.key + 'Every';
  addParams([['Events', fk, `${d.name}: every (ticks)`, 0, 120000, 1000, d.every], ...d.params], Object.assign({
    [fk]: `${d.name}: average number of ticks between automatic occurrences (a chance is rolled every 100 ticks; a year is 6,000 ticks at default settings). 0 = never by itself. Needs Automatic events on. ${d.tip}`,
  }, d.tips));
  Object.assign(Events.causeLabels, d.causes);
  return d;
}

const Events = {
  active: [],                   // running events: { id, key, def, start, x, y, auto, note, entry, ...own fields }
  log: [],                      // { key, name, start, end (null while active), note }, oldest first
  nextId: 1,
  logVersion: 0,                // bumped on every log change, so the UI only redraws the list when needed
  causeLabels: {},              // death cause -> label for the stats panel (from each def's `causes`)

  isActive(key) { for (const ev of this.active) if (ev.key === key) return true; return false; },

  // Start an event now. opts: { x, y } for point events, plus anything the event's start() understands.
  // Returns the event, or null if start() returned false (nothing to do, e.g. nobody to infect).
  trigger(key, opts = {}) {
    const def = EVENT_BY_KEY[key];
    if (!def) throw new Error('Unknown event: ' + key);
    const ev = { id: this.nextId++, key, def, start: Sim.tick, x: opts.x ?? null, y: opts.y ?? null, auto: !!opts.auto, note: '' };
    if (def.start && def.start(ev, opts) === false) return null;
    ev.entry = { key, name: def.name, start: ev.start, end: null, note: ev.note };
    this.log.push(ev.entry);
    this.trimLog();
    this.active.push(ev);
    if (!def.update) this.stop(ev);           // no update(): a one-shot event, all done in start()
    this.logVersion++;
    return ev;
  },
  // End an event early (or when its update() returned false): calls its end(), closes its log entry
  stop(ev) {
    const i = this.active.indexOf(ev); if (i < 0) return;
    this.active.splice(i, 1);
    if (ev.def.end) ev.def.end(ev);
    ev.entry.end = Sim.tick; ev.entry.note = ev.note; this.logVersion++;
  },
  // Update the log text of a running event (shown on the log entry's hover)
  note(ev, text) { ev.note = text; if (ev.entry) ev.entry.note = text; this.logVersion++; },
  trimLog() {
    while (this.log.length > EVENT_LOG_MAX) {
      const k = this.log.findIndex(e => e.end !== null); if (k < 0) break;
      this.log.splice(k, 1);
    }
  },

  // every tick (system, 'post' phase): automatic triggers every 100 ticks, then each active event's update
  update(tick) {
    if (tick % 100 === 0 && P.eventsOn && tick >= EVENT_GRACE) for (const def of EVENT_DEFS) {   // none in the first year
      const every = P[def.key + 'Every'];
      if (!(every > 0) || (!def.stack && this.isActive(def.key))) continue;   // no random draw unless it could happen
      if (Math.random() < 100 / every) this.trigger(def.key, this.autoOpts(def));
    }
    if (!this.active.length) return;
    for (const ev of this.active.slice()) if (ev.def.update(ev, tick) === false) this.stop(ev);
  },
  // where an automatic event happens: the def's own autoOpts(), else random dry land for point events
  autoOpts(def) {
    if (def.autoOpts) return Object.assign({ auto: true }, def.autoOpts());
    if (!def.needsPoint) return { auto: true };
    const [x, y] = Sim.randomLand();
    return { auto: true, x, y };
  },

  // Hook: pass a core value through every active event's modify[hook](value, ctx, ev). Cheap and RNG-free when
  // nothing is active. Hooks in the core: 'spawn' (Sim.step), 'mutation' (Sim.breed). See DESIGN.md §14.
  modify(hook, value, ctx) {
    const A = this.active;
    for (let i = 0; i < A.length; i++) { const f = A[i].def.modify[hook]; if (f) value = f(value, ctx, A[i]); }
    return value;
  },
  // inspector Status line: what the active events say about this simlet ('' = nothing)
  describe(s) {
    let out = '';
    for (const ev of this.active) if (ev.def.describe) { const t = ev.def.describe(s, ev); if (t) out += (out ? ' · ' : '') + t; }
    return out;
  },
  // map overlays: above the terrain layers (fallow, farmland, ruins, floodwater), below night shading, food and simlets
  draw(ctx, R) { for (const ev of this.active) if (ev.def.draw) ev.def.draw(ctx, ev, R); },

  reset() { this.active = []; this.log = []; this.nextId = 1; this.logVersion++; },
  save() {
    return {
      nextId: this.nextId, log: this.log,
      active: this.active.map(ev => ({ id: ev.id, key: ev.key, start: ev.start, x: ev.x, y: ev.y, auto: ev.auto, note: ev.note,
                                       entry: this.log.indexOf(ev.entry), data: ev.def.save ? ev.def.save(ev) : null })),
    };
  },
  load(o) {
    this.log = o.log || []; this.nextId = o.nextId || 1; this.active = [];
    for (const a of o.active || []) {
      const entry = this.log[a.entry];
      const def = EVENT_BY_KEY[a.key];
      if (!def) { if (entry) entry.end = Sim.tick; continue; }   // its event file is gone: just close the log entry
      const ev = { id: a.id, key: a.key, def, start: a.start, x: a.x, y: a.y, auto: a.auto, note: a.note,
                   entry: entry || { key: a.key, name: def.name, start: a.start, end: null, note: a.note } };
      if (!entry) this.log.push(ev.entry);
      if (def.load) def.load(ev, a.data);
      this.active.push(ev);
    }
    this.logVersion++;
  },
};

registerSystem({ name: 'events', phase: 'post', every: 1,
  update: tick => Events.update(tick), reset: () => Events.reset(), save: () => Events.save(), load: o => Events.load(o) });
