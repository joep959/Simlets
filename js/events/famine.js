'use strict';
// Famine event: STUB. Placeholder registered by the events framework (js/events.js); the real event is built in
// this file only. See DESIGN.md §14 for the recipe and the hooks available.

defineEvent({
  key: 'famine', name: 'Famine', color: '#d4a72c', needsPoint: false,
  tip: 'A blight: wild food grows poorly. Not built yet: triggering it only marks it on the log and the population chart for 500 ticks.',
  params: [],                   // [section, key, label, min, max, step, default] rows for this event's own sliders
  tips: {},                     // hover text for those sliders
  start(ev, opts) { Events.note(ev, 'placeholder (does nothing yet)'); },
  update(ev, tick) { return tick - ev.start < 500; },   // false = finished
});
