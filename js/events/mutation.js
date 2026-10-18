'use strict';
// Radiation event: STUB. Placeholder registered by the events framework (js/events.js); the real event is built in
// this file only. See DESIGN.md §14 for the recipe and the hooks available.

defineEvent({
  key: 'mutation', name: 'Radiation', color: '#e45aa8', needsPoint: true,
  tip: 'A radiation leak raises mutation near its source. Not built yet: triggering it only marks it on the log and the population chart for 500 ticks.',
  params: [],                   // [section, key, label, min, max, step, default] rows for this event's own sliders
  tips: {},                     // hover text for those sliders
  start(ev, opts) { Events.note(ev, 'placeholder (does nothing yet)'); },
  update(ev, tick) { return tick - ev.start < 500; },   // false = finished
});
