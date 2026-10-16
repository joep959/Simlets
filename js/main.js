'use strict';
// Boot + main loop. Simulation steps are decoupled from drawing: speed = sim ticks per drawn frame.

(function boot() {
  let loaded = false;
  try {
    const saved = localStorage.getItem('simlet-map');
    if (saved) { World.fromJSON(saved); loaded = true; }
  } catch (e) { /* no saved map or storage blocked */ }
  if (!loaded) World.fill(TERRAIN.GRASS);          // first visit: blank canvas to paint on

  if (loaded) Sim.seed(); else Sim.reset();
  Render.init($('map'));
  Charts.init();
  UI.init();
  if (!loaded) UI.setMode('edit');
  window.addEventListener('resize', () => { Render.resize(); Charts.resize(); });

  let acc = 0, frameNo = 0, tpsTicks = 0, tpsT0 = performance.now();

  function frame() {
    if (UI.running && UI.mode === 'run') {
      const spd = SPEEDS[UI.speedIdx];
      if (spd === 'Max') {
        const t0 = performance.now();
        while (performance.now() - t0 < 28 && Sim.simlets.length) { Sim.step(); tpsTicks++; }
      } else {
        acc += spd;
        while (acc >= 1) { Sim.step(); acc--; tpsTicks++; }
      }
    }

    if (UI.follow && UI.selected && !UI.selected.dead) { Render.cam.x = UI.selected.x; Render.cam.y = UI.selected.y; }
    Render.draw(UI.selected, UI.mode === 'edit');

    frameNo++;
    if (frameNo % 6 === 0) UI.updateStats();
    if (frameNo % 10 === 0) { Charts.draw(); UI.renderInspector(); }
    const now = performance.now();
    if (now - tpsT0 > 1000) { UI.tps = tpsTicks * 1000 / (now - tpsT0); tpsTicks = 0; tpsT0 = now; }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
