'use strict';
// The app shell (top bar, icon rail + drawer, right panel, chart strip, full screen), transport controls, map
// editor, parameter sliders, inspector. Pointer input on the map (mouse, touch, pinch) and keyboard shortcuts.

const SPEEDS = [0.25, 0.5, 1, 2, 4, 8, 16, 32, 64, 128, 'Max'];   // ticks per frame
const $ = id => document.getElementById(id);

const UI = {
  running: true, speedIdx: 2, mode: 'run', brush: 'water', brushSize: 3,
  selected: null, follow: false, tps: 0, armed: null,   // armed: null, 'drop' or an event key (waiting for a map click)

  init() {
    // phones: narrow screen. Touch phones start with a lower population cap (a default only: the slider still goes to 3000)
    this.mobile = matchMedia('(max-width: 760px)').matches;
    if (this.mobile && matchMedia('(pointer: coarse)').matches) P.maxPop = Math.min(P.maxPop, 600);
    // transport
    $('btnPlay').onclick = $('hudPlay').onclick = () => this.setRunning(!this.running);
    $('btnStep').onclick = () => { this.setRunning(false); Sim.step(); };
    $('speed').oninput = e => { this.speedIdx = +e.target.value; $('speedLbl').textContent = this.speedLabel(); };
    $('speedLbl').textContent = this.speedLabel();

    // mode + editor
    $('modeRun').onclick = () => this.setMode('run');
    $('modeEdit').onclick = () => this.setMode('edit');
    const bw = $('brushes');
    BRUSHES.forEach((t, i) => {
      const b = document.createElement('button');
      b.className = 'brush' + (t.key === this.brush ? ' on' : '');
      b.innerHTML = `<i class="sw" style="background:${t.color}"></i>${t.name}`;
      b.dataset.tip = t.tip;
      b.onclick = () => { this.brush = t.key; [...bw.children].forEach((c, j) => c.classList.toggle('on', j === i)); };
      bw.appendChild(b);
    });
    $('brushSize').oninput = e => { this.brushSize = +e.target.value; $('brushLbl').textContent = this.brushSize; };
    $('mapBlank').onclick = () => { World.fill(TERRAIN.GRASS); this.mapChanged(); this.clearWorld(); };
    $('mapGen').onclick = () => { World.generate(); this.mapChanged(); this.clearWorld(); };
    $('mapSave').onclick = () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([World.toJSON()], { type: 'application/json' }));
      a.download = 'simlet-map.json'; a.click(); URL.revokeObjectURL(a.href);
    };
    $('mapLoad').onclick = () => $('mapFile').click();
    $('mapFile').onchange = e => {
      const f = e.target.files[0]; if (!f) return;
      f.text().then(t => { try { World.fromJSON(t); this.mapChanged(); this.clearWorld(); } catch (err) { alert('Could not load map: ' + err.message); } });
      e.target.value = '';
    };
    const setBrain = m => {
      Brain.mode = m;
      $('brainRules').classList.toggle('on', m === 'rules'); $('brainHybrid').classList.toggle('on', m === 'hybrid');
      if (this.selected) this.renderInspector(true);
    };
    $('brainRules').onclick = () => setBrain('rules');
    $('brainHybrid').onclick = () => setBrain('hybrid');
    $('worldSave').onclick = () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(Save.serialize())], { type: 'application/json' }));
      a.download = `simlets-world-t${Sim.tick}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    };
    $('worldLoad').onclick = () => $('worldFile').click();
    $('worldFile').onchange = e => {
      const f = e.target.files[0]; if (!f) return;
      f.text().then(t => {
        try {
          Save.restore(JSON.parse(t));
          for (const k in this.paramInputs) this.paramInputs[k]();       // sliders show the loaded settings
          setBrain(Brain.mode);
          this.selected = null; this.follow = false; this.setRunning(false); this.setMode('run');
          this.renderInspector(true); this.updateStats(); Charts.draw();
        } catch (err) { alert('Could not load world: ' + err.message); }
      });
      e.target.value = '';
    };
    $('btnDrop').onclick = () => this.arm(this.armed === 'drop' ? null : 'drop');
    $('btnReseed').onclick = $('btnReseed2').onclick = () => this.reseed();

    $('legendBtn').onclick = () => {
      const c = $('legend').classList.toggle('collapsed');
      $('legendBtn').textContent = c ? 'Key ▸' : 'Key ▾';
    };
    $('scentBtn').onclick = () => {
      Render.showScent = !Render.showScent;
      $('scentBtn').textContent = 'Scent: ' + (Render.showScent ? 'on' : 'off');
    };
    $('scentBtn').dataset.tip = 'Show the plant-eater scent trails that predators track (purple). Stronger colour = fresher, stronger scent.';
    $('colorBy').onclick = () => {
      Render.colorBy = { diet: 'species', species: 'lineage', lineage: 'diet' }[Render.colorBy];
      $('colorBy').textContent = 'Colour: ' + Render.colorBy;
    };
    $('colorBy').dataset.tip = 'Click to cycle. Diet: green = herbivore, blue = omnivore, orange = carnivore. Species: each genetic cluster gets its own colour (grey = small species). Lineage: colour calculated straight from the genome, so close relatives share a hue. Shape always shows diet.';
    this.buildParams();
    this.buildEvents();
    this.initTips();
    this.bindMap();
    this.initShell();
    if (this.mobile) { Render.resize(); Render.fit(); }   // phones: fill the screen with map
    window.addEventListener('keydown', e => {
      const typing = e.target.tagName === 'INPUT' && e.target.type !== 'range' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA';
      if (e.code === 'Escape') { this.arm(null); this.expandChart(null); }
      if (typing) return;
      if (e.code === 'Space') { e.preventDefault(); this.setRunning(!this.running); }
      else if (e.key === '[') this.toggleLeft();
      else if (e.key === ']') this.setLayout({ right: !this.layout.right });
      else if (e.key === 'c' || e.key === 'C') this.setLayout({ charts: !this.layout.charts });
      else if (e.key === 'f' || e.key === 'F') this.setFull(!this.layout.fs);
    });
  },

  // ---- app shell: drawer panes, panels, chart strip, full screen; the layout is remembered per browser ----
  initShell() {
    this.layoutKey = this.mobile ? 'simlet-layout-m' : 'simlet-layout';      // phones remember their own layout
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(this.layoutKey) || '{}'); } catch (e) { /* storage blocked: defaults */ }
    const base = this.mobile ? { pane: 'sim', left: false, right: false, charts: false } : { pane: 'sim', left: true, right: true, charts: true };
    this.layout = Object.assign(base, saved, { fs: false });
    $('railRight').onclick = () => this.setLayout({ right: !this.layout.right });
    document.querySelectorAll('.railbtn').forEach(b => b.onclick = () => {
      if (this.layout.left && this.layout.pane === b.dataset.pane) this.setLayout({ left: false });
      else this.setLayout({ left: true, pane: b.dataset.pane });
    });
    $('btnCharts').onclick = () => this.setLayout({ charts: !this.layout.charts });
    $('btnRight').onclick = () => this.setLayout({ right: !this.layout.right });
    $('btnFull').onclick = $('hudExit').onclick = () => this.setFull(!this.layout.fs);
    document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && this.layout.fs) this.setFull(false); });
    // chart strip: an expand button on each chart; in titles-only mode, clicking a title expands that chart
    document.querySelectorAll('#charts .chart').forEach(ch => {
      const b = document.createElement('button');
      b.className = 'cexp'; b.textContent = '⤢'; b.dataset.tip = 'Expand this chart over the map (Esc or ⤢ to close)';
      b.onclick = e => { e.stopPropagation(); this.expandChart(ch.classList.contains('big') ? null : ch); };
      ch.querySelector('.ctitle').appendChild(b);
      ch.querySelector('.ctitle').addEventListener('click', e => {
        if (!this.layout.charts && !ch.classList.contains('big') && e.target.tagName !== 'SELECT') this.expandChart(ch);
      });
    });
    // the map canvas follows its box (drawer, panels and chart strip all change it), not just the window
    new ResizeObserver(() => Render.resize()).observe($('mapWrap'));
    $('paramSearch').oninput = e => this.filterParams(e.target.value);
    // phones: drag a bottom sheet down to close it (from its handle, or anywhere while it is scrolled to the top);
    // a drag that starts upwards scrolls the sheet as normal
    for (const sheet of [$('left'), $('right')]) {
      let y0 = null, dy = 0;
      sheet.addEventListener('touchstart', e => {
        if (!this.mobile || e.touches.length !== 1) { y0 = null; return; }
        const y = e.touches[0].clientY;
        y0 = sheet.scrollTop <= 0 || y - sheet.getBoundingClientRect().top < 32 ? y : null; dy = 0;
      }, { passive: true });
      sheet.addEventListener('touchmove', e => {
        if (y0 === null) return;
        dy = e.touches[0].clientY - y0;
        if (dy <= 0) { y0 = null; sheet.style.transform = ''; return; }    // going up: a normal scroll
        e.preventDefault();
        sheet.style.transition = 'none'; sheet.style.transform = `translateY(${dy}px)`;
      }, { passive: false });
      const end = () => {
        if (y0 === null && !sheet.style.transform) return;
        y0 = null; sheet.style.transition = 'transform 0.15s'; sheet.style.transform = '';
        if (dy > 70) this.setLayout(sheet.id === 'left' ? { left: false } : { right: false });
        dy = 0;
      };
      sheet.addEventListener('touchend', end); sheet.addEventListener('touchcancel', end);
    }
    this.setLayout({});
  },
  setLayout(change) {
    if (this.mobile && change.left) change.right = false;                    // phones: one bottom sheet at a time
    if (this.mobile && change.right) change.left = false;
    Object.assign(this.layout, change);
    const L = this.layout, B = document.body.classList;
    B.toggle('left-closed', !L.left); B.toggle('right-closed', !L.right); B.toggle('charts-mini', !L.charts); B.toggle('fs', L.fs);
    document.querySelectorAll('.railbtn').forEach(b => b.classList.toggle('on', L.left && b.dataset.pane === L.pane));
    document.querySelectorAll('.pane').forEach(p => p.classList.toggle('on', p.dataset.pane === L.pane));
    $('btnCharts').classList.toggle('on', L.charts); $('btnRight').classList.toggle('on', L.right); $('railRight').classList.toggle('on', L.right);
    $('hud').classList.toggle('hidden', !L.fs);
    try { localStorage.setItem(this.layoutKey, JSON.stringify(L)); } catch (e) { /* fine */ }
  },
  toggleLeft() { this.setLayout({ left: !this.layout.left }); },
  setFull(on) {
    this.setLayout({ fs: on });
    try {
      if (on && !document.fullscreenElement && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
      if (!on && document.fullscreenElement) document.exitFullscreen().catch(() => {});
    } catch (e) { /* the browser refused: the in-page full screen still applies */ }
    setTimeout(() => { Render.resize(); Render.fit(); }, 120);   // after the layout (and the browser's full screen) settles
  },
  expandChart(ch) {
    document.querySelectorAll('#charts .chart.big').forEach(c => { if (c !== ch) c.classList.remove('big'); });
    if (ch) ch.classList.add('big');
    requestAnimationFrame(() => { Charts.resize(); Charts.draw(); });
  },
  // settings search: show matching sliders (label, section or tip text) and open their sections
  filterParams(q) {
    q = q.trim().toLowerCase();
    document.querySelectorAll('#params details').forEach(det => {
      let any = false;
      det.querySelectorAll('.param').forEach(p => { const hit = !q || p.dataset.search.includes(q); p.classList.toggle('hidden', !hit); any = any || hit; });
      det.classList.toggle('hidden', !any);
      if (q) det.open = any;
    });
  },
  // at-a-glance numbers for the top bar and the full-screen HUD
  updateGlance(h, o, c) {
    const n = Math.max(1, World.landTiles.length), pc = k => Math.round(100 * k / n);
    const g = `<span data-tip="Population, then herbivores / omnivores / carnivores"><b>${Sim.simlets.length.toLocaleString()}</b> ` +
      `<span style="color:var(--herb)">●${h}</span> <span style="color:var(--omni)">◆${o}</span> <span style="color:var(--carn)">▲${c}</span></span>` +
      `<span class="gsep"></span><span data-tip="Species alive (with at least the 'Smallest species listed' number of members)"><b>${Species.shown().length}</b> species</span>` +
      `<span class="gsep gland"></span><span class="gland" data-tip="Share of the land that is fertile / forest">fertile <b>${pc(World.fertileTiles.length)}%</b> forest <b>${pc(World.forestTiles.length)}%</b></span>`;
    const ev = Events.active.map(e => { const d = e.def || EVENT_BY_KEY[e.key]; return d ? `<span class="evchip" style="border-color:${d.color}" data-tip="${d.name} is running">${d.name}</span>` : ''; }).join('');
    if (g !== this._glance) { $('glance').innerHTML = $('hudGlance').innerHTML = g; this._glance = g; }
    if (ev !== this._evchips) { $('evChips').innerHTML = $('hudEvents').innerHTML = ev; this._evchips = ev; }
    if (this.layout && this.layout.fs) $('hudClock').textContent = `Day ${Math.floor(Sim.tick / P.dayLength)} · ${World.season(Sim.tick) ? 'BUST' : 'BOOM'} · ${SPEEDS[this.speedIdx] === 'Max' ? 'Max' : '×' + SPEEDS[this.speedIdx]}`;
  },

  // Point actions wait for a click on the map: 'drop' (Air-drop) or an event key (point events). null disarms; Esc too.
  arm(what) {
    if (what && this.mode !== 'run') this.setMode('run');
    this.armed = what;
    $('btnDrop').classList.toggle('armed', what === 'drop');
    $('btnDrop').textContent = what === 'drop' ? 'Click the map to drop… (Esc)' : 'Air-drop tribe…';
    for (const def of EVENT_DEFS) {
      const b = this.eventBtns && this.eventBtns[def.key]; if (!b) continue;
      b.classList.toggle('armed', what === def.key);
      b.textContent = what === def.key ? 'Click map (Esc)' : def.name + (def.needsPoint ? '…' : '');
    }
    $('map').style.cursor = what ? 'copy' : this.mode === 'edit' ? 'cell' : 'crosshair';
  },

  // Events panel: one trigger button per event (point events arm a map click), and the recent-events log
  buildEvents() {
    const box = $('eventBtns'); this.eventBtns = {};
    for (const def of EVENT_DEFS) {
      const b = document.createElement('button');
      b.className = 'btn sm evbtn';
      b.style.borderLeft = `3px solid ${def.color}`;
      b.dataset.tip = `Trigger ${def.name} now. ${def.tip}${def.needsPoint ? ' Then click the map where it happens (Esc cancels).' : ' Starts at once.'}`;
      b.onclick = () => {
        if (!def.needsPoint) { this.arm(null); Events.trigger(def.key); this.renderEventLog(); }
        else this.arm(this.armed === def.key ? null : def.key);
      };
      box.appendChild(b); this.eventBtns[def.key] = b;
    }
    this.arm(null);                                  // sets the button labels
    this.renderEventLog();
  },
  renderEventLog() {
    if (this._logV === Events.logVersion) return;
    this._logV = Events.logVersion;
    const esc = t => String(t).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    const rows = Events.log.slice(-8).reverse().map(e => {
      const def = EVENT_BY_KEY[e.key], col = def ? def.color : '#888';
      const when = e.end === null ? `t${e.start} · <b>active</b>` : `t${e.start}–${e.end}`;
      const tip = `${e.name}: started at tick ${e.start}${e.end === null ? ', still running' : `, ended at tick ${e.end}`}.${e.note ? ' ' + e.note : ''}`;
      return `<div class="evrow" data-tip="${esc(tip)}"><i class="sw" style="background:${col}"></i><span>${esc(e.name)}</span><span class="muted">${when}</span></div>`;
    }).join('');
    $('eventLog').innerHTML = rows || '<p class="hint" style="margin:6px 0 0">No events yet.</p>';
  },
  speedLabel() { const s = SPEEDS[this.speedIdx]; return s === 'Max' ? 'Max' : '×' + s; },
  setRunning(r) { this.running = r; $('btnPlay').textContent = $('hudPlay').textContent = r ? '❚❚' : '▶'; },
  setMode(m) {
    this.mode = m;
    $('modeRun').classList.toggle('on', m === 'run'); $('modeEdit').classList.toggle('on', m === 'edit');
    $('editTools').classList.toggle('hidden', m !== 'edit'); $('runHint').classList.toggle('hidden', m === 'edit');
    $('map').style.cursor = m === 'edit' ? 'cell' : 'crosshair';
    if (m === 'run') {
      this.mapChanged();
      if (Sim.tick === 0 && !Sim.simlets.length) Sim.seed();   // fresh map: drop tribes in on Run
    }
  },
  mapChanged() {
    World.rebuildLists(); Food.removeOnWater();
    try { localStorage.setItem('simlet-map', World.toJSON()); } catch (e) { /* storage unavailable: fine */ }
  },
  // empty world at tick 0: no simlets, no food, charts reset
  clearWorld() {
    Sim.reset(); this.selected = null; this.follow = false; this.renderInspector(true);
  },
  reseed() {
    Sim.seed(); this.selected = null; this.follow = false; this.renderInspector(true);
  },

  buildParams() {
    const root = $('params'), sections = new Map();       // rows join their section wherever they were added
    const reset = document.createElement('button');
    reset.className = 'btn wide'; reset.style.margin = '0 0 8px'; reset.textContent = 'Restore default settings';
    reset.onclick = () => {
      for (const d of PARAM_DEFS) { P[d[1]] = d[6]; this.paramInputs[d[1]](); }
    };
    root.appendChild(reset);
    this.paramInputs = {};
    const defaults = Object.fromEntries(PARAM_DEFS.map(d => [d[1], d[6]]));
    for (const [sec, key, label, min, max, step] of PARAM_DEFS) {
      let det = sections.get(sec);
      if (!det) {
        det = document.createElement('details');
        det.innerHTML = `<summary>${sec}${sec === 'Population' ? ' <span class="muted">(applies on restart)</span>' : ''}</summary>`;
        root.appendChild(det); sections.set(sec, det);
      }
      const wrap = document.createElement('div'); wrap.className = 'param';
      wrap.innerHTML = `<label class="lbl" data-tip="${PARAM_TIPS[key] || ''}">${label} <span class="val"></span></label><input type="range" min="${min}" max="${max}" step="${step}">`;
      wrap.dataset.search = `${label} ${sec} ${PARAM_TIPS[key] || ''}`.toLowerCase();
      const inp = wrap.querySelector('input'), val = wrap.querySelector('.val');
      const mark = () => wrap.classList.toggle('changed', P[key] !== defaults[key]);   // dot = changed from default
      inp.value = P[key]; val.textContent = P[key]; mark();
      inp.oninput = () => { P[key] = +inp.value; val.textContent = inp.value; mark(); };
      this.paramInputs[key] = () => { inp.value = P[key]; val.textContent = P[key]; mark(); };   // refresh after restore
      det.appendChild(wrap);
    }
  },

  // ---- map pointer handling (mouse, pen, touch): wheel or pinch zoom, drag pan, click/tap select, paint in edit
  // mode (left button or one finger). Right-drag or two fingers always pan. ----
  bindMap() {
    const c = $('map'); let drag = null;
    const pts = new Map();                            // active pointers: id -> [px, py]
    let pinch = null;                                 // { d, mx, my } while two fingers are down
    const local = e => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const zoomAt = (px, py, k) => {
      const [wx, wy] = Render.toWorld(px, py);
      Render.cam.zoom = clamp(Render.cam.zoom * k, 1, 60);
      const [nx, ny] = Render.toWorld(px, py);       // keep the point under the cursor / fingers fixed
      Render.cam.x += wx - nx; Render.cam.y += wy - ny;
    };
    const two = () => { const [a, b] = [...pts.values()]; return { d: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, mx: (a[0] + b[0]) / 2, my: (a[1] + b[1]) / 2 }; };
    c.style.touchAction = 'none';                     // the page must not scroll or zoom under the map
    c.addEventListener('contextmenu', e => e.preventDefault());
    c.addEventListener('wheel', e => {
      e.preventDefault();
      const [px, py] = local(e);
      zoomAt(px, py, e.deltaY < 0 ? 1.15 : 1 / 1.15);
    }, { passive: false });
    c.addEventListener('pointerdown', e => {
      c.setPointerCapture(e.pointerId);
      const [px, py] = local(e);
      pts.set(e.pointerId, [px, py]);
      if (pts.size === 2) { pinch = two(); if (drag) drag.moved = true; drag = null; return; }   // second finger: pinch, not paint
      if (pts.size > 2) return;
      const paint = this.mode === 'edit' && e.button === 0;
      drag = { px, py, sx: px, sy: py, moved: false, paint };
      if (paint) this.paintAt(px, py);
    });
    c.addEventListener('pointermove', e => {
      if (!pts.has(e.pointerId)) return;
      const [px, py] = local(e);
      pts.set(e.pointerId, [px, py]);
      if (pinch && pts.size === 2) {
        const now = two();
        zoomAt(now.mx, now.my, now.d / pinch.d);
        Render.cam.x -= (now.mx - pinch.mx) / Render.cam.zoom; Render.cam.y -= (now.my - pinch.my) / Render.cam.zoom;
        pinch = now; this.follow = false;
        return;
      }
      if (!drag) return;
      if (Math.hypot(px - drag.sx, py - drag.sy) > (e.pointerType === 'touch' ? 10 : 4)) drag.moved = true;
      if (drag.paint) this.paintLine(drag.px, drag.py, px, py);
      else {
        Render.cam.x -= (px - drag.px) / Render.cam.zoom; Render.cam.y -= (py - drag.py) / Render.cam.zoom;
        if (drag.moved) this.follow = false;
      }
      drag.px = px; drag.py = py;
    });
    const up = e => {
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (pts.size) return;                           // wait for the last finger
      if (e.type === 'pointercancel' && drag) drag.moved = true;   // the browser took the gesture: not a tap
      if (drag && !drag.moved && !drag.paint && this.mode === 'run' && this.armed) {
        const [x, y] = Render.toWorld(drag.sx, drag.sy);
        if (x > 0 && y > 0 && x < WORLD_W && y < WORLD_H) {
          if (this.armed === 'drop') Sim.dropTribe(x, y, 'air-drop');
          else { Events.trigger(this.armed, { x, y }); this.renderEventLog(); }
        }
        this.arm(null);
      } else if (drag && !drag.moved && !drag.paint && this.mode === 'run') {
        this.selected = Render.pick(drag.sx, drag.sy, e.pointerType === 'touch' ? 22 : 8);
        if (!this.selected && this.mobile) this.setLayout({ left: false, right: false });
        this.renderInspector(true);
      }
      if (drag && drag.paint) this.mapChanged();
      drag = null;
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
  },
  paintAt(px, py) {
    const [x, y] = Render.toWorld(px, py);
    World.paint(x, y, this.brushSize, this.brush);
  },
  // stamp the brush along the segment between two pointer positions, so a fast stroke leaves no gaps
  paintLine(px0, py0, px1, py1) {
    const [x0, y0] = Render.toWorld(px0, py0), [x1, y1] = Render.toWorld(px1, py1);
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / Math.max(0.5, this.brushSize / 2)));   // stamps half a radius apart
    for (let k = 1; k <= n; k++) World.paint(x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n, this.brushSize, this.brush);
  },

  // ---- left-panel live readouts ----
  updateStats() {
    const t = Sim.tick, day = Math.floor(t / P.dayLength), bust = World.season(t) === 1;
    $('tickNum').textContent = t.toLocaleString();
    $('dayNum').textContent = day;
    $('dayIcon').textContent = World.isNight(t) ? '☾' : '☀';
    $('seasonName').textContent = bust ? 'BUST' : 'BOOM';
    $('seasonBar').style.width = (World.seasonProgress(t) * 100).toFixed(1) + '%';
    $('seasonBar').style.background = bust ? 'var(--warn)' : 'var(--herb)';
    let h = 0, o = 0, c = 0;
    for (const s of Sim.simlets) { const d = s.g[G.diet]; if (d < 0.33) h++; else if (d > 0.66) c++; else o++; }
    const landShare = () => { const n = Math.max(1, World.landTiles.length), pc = k => Math.round(100 * k / n) + '%'; return `${pc(World.fertileTiles.length)} / ${pc(World.forestTiles.length)}`; };
    const rows = [
      ['Population', Sim.simlets.length], ['Herbivores', h], ['Omnivores', o], ['Carnivores', c],
      ['Food items', Food.count], ['Births', Sim.births], ['↳ sexual / asexual', `${Sim.birthsSex.toLocaleString()} / ${Sim.birthsAsex.toLocaleString()}`], ['Starved', Sim.deaths.starved],
      ['Killed', Sim.deaths.killed], ['Old age', Sim.deaths.old],
      ...Object.keys(Sim.deaths).filter(k => k !== 'starved' && k !== 'killed' && k !== 'old')       // event causes (plague...)
        .map(k => [Events.causeLabels[k] || 'Died: ' + k, Sim.deaths[k]]),
      ['Alarms raised', Sim.alarms],
      ['Farming acts', Sim.farmEvents], ['Newcomer tribes', Sim.arrivals], ['Shelters built / building', `${[...Shelters.tiles.values()].filter(s => s.done).length} / ${[...Shelters.tiles.values()].filter(s => !s.done).length}`], ['Food in shelters', Math.round([...Shelters.tiles.values()].reduce((a, s) => a + s.store, 0))], ['Land fertile / forest', landShare()], ['Species alive', Species.shown().length], ...(Brain.mode === 'hybrid' ? [['Brain influence', Sim.brainInfluence.toFixed(3)]] : []), ['Species extinct', Species.extinctCount], ['Ticks / sec', Math.round(this.tps)],
    ];
    $('stats').innerHTML = rows.map(([k, v]) => `<span>${k}</span><b>${v.toLocaleString()}</b>`).join('');
    this.updateGlance(h, o, c);
    this.renderEventLog();
    $('extinct').classList.toggle('hidden', Sim.simlets.length > 0 || Sim.tick === 0 || this.mode === 'edit');
  },

  // ---- hover explanations: any element with data-tip shows a floating note ----
  initTips() {
    const tip = $('itip');
    // touch screens have no hover: press and hold anything with a tip to read it; it hides on the next touch
    let hold = null;
    document.addEventListener('pointerdown', e => {
      if (e.pointerType !== 'touch') return;
      tip.classList.add('hidden'); clearTimeout(hold);
      const t = e.target.closest && e.target.closest('[data-tip]'); if (!t || !t.dataset.tip) return;
      hold = setTimeout(() => {
        tip.textContent = t.dataset.tip; tip.classList.remove('hidden');
        const r = t.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
        tip.style.left = clamp(r.left + r.width / 2 - w / 2, 8, window.innerWidth - w - 8) + 'px';
        tip.style.top = (r.top - h - 10 > 8 ? r.top - h - 10 : Math.min(window.innerHeight - h - 8, r.bottom + 10)) + 'px';
      }, 450);
    });
    document.addEventListener('pointerup', () => clearTimeout(hold));
    document.addEventListener('pointercancel', () => clearTimeout(hold));
    document.addEventListener('mouseover', e => {
      const t = e.target.closest && e.target.closest('[data-tip]');
      if (!t || !t.dataset.tip) { tip.classList.add('hidden'); return; }
      tip.textContent = t.dataset.tip; tip.classList.remove('hidden');
      const r = t.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
      let x = r.left - w - 10;                               // prefer the left side (inspector is at the screen edge)
      if (x < 8) x = Math.min(window.innerWidth - w - 8, r.right + 10);
      tip.style.left = x + 'px';
      tip.style.top = clamp(r.top + r.height / 2 - h / 2, 8, window.innerHeight - h - 8) + 'px';
    });
  },

  // ---- right-panel inspector: built once per selection, then live values updated in place ----
  renderInspector(force) {
    const s = this.selected, el = $('inspector');
    if (!s) { this._insp = null; Render.highlight = null; this.renderSpeciesList(); return; }
    if (force || this._insp !== s) {
      this.buildInspector(s); this._insp = s;
      if (this.layout && !this.layout.right && !this.layout.fs) this.setLayout({ right: true });   // selecting opens the inspector
    }
    this.updateInspector(s);
  },

  brainHeatmap(b) {
    const m = brainInfluence(b);
    let mx = 0; for (const r of m) for (const v of r) mx = Math.max(mx, Math.abs(v));
    const tip = t => ` data-tip="${t.replace(/"/g, '&quot;')}"`;
    const cell = (v, i, o) => {
      const k = mx > 0 ? Math.min(1, Math.abs(v) / mx) : 0;
      const c = v >= 0 ? `rgba(217,89,38,${k.toFixed(2)})` : `rgba(57,135,229,${k.toFixed(2)})`;
      const act = BRAIN_ACTION_NAMES[BRAIN_OUT[o]], inp = BRAIN_INPUT_TIPS[BRAIN_IN[i]];
      let t;
      if (Math.abs(v) < 0.01) t = `${inp} → ${act}: no learned effect yet.`;
      else {
        const dir = v > 0 ? 'RAISES' : 'LOWERS', when = BRAIN_IN[i] === 'bias' ? 'Always' : 'When this input is high (1)';
        const size = Math.abs(v) < 0.05 ? 'a tiny amount' : Math.abs(v) < 0.2 ? 'a little' : Math.abs(v) < 0.5 ? 'noticeably' : 'strongly';
        t = `${inp} → ${act}. ${when}, the brain ${dir} the ${act} score by about ${Math.abs(v).toFixed(2)} (${size}; rule scores are usually 0.1–1.5). Rough guide only: ignores how inputs combine.`;
      }
      return `<i style="background:${c}"${tip(t)}></i>`;
    };
    return `<div class="bheat" style="grid-template-columns: 66px repeat(${NO}, minmax(0, 1fr))"><span></span>${BRAIN_OUT.map(k => `<b${tip('Column: ' + BRAIN_ACTION_NAMES[k])}>${k.slice(0, 3)}</b>`).join('')}` +
      m.map((r, i) => `<span${tip('Row input: ' + BRAIN_INPUT_TIPS[BRAIN_IN[i]])}>${BRAIN_IN[i]}</span>${[...r].map((v, o) => cell(v, i, o)).join('')}`).join('') +
      `</div><p class="hint" style="margin-top:6px"><b style="color:#d95926">■</b> raises the action · <b style="color:#3987e5">■</b> lowers it · stronger colour = stronger effect, relative to this brain's strongest link${mx > 0 ? ` (${mx.toFixed(2)})` : ''}. Blank = no effect. Hover a cell for details.</p>`;
  },

  // Relatives among the living: parents, children (either parent), siblings (share a parent), plus species-mates
  updateFamily(s) {
    const mode = this.hlMode || 'none';
    document.querySelectorAll('#inspector .hl').forEach(b => b.classList.toggle('on', b.dataset.hl === mode));
    const parents = [], children = [], siblings = [], roles = new Map();
    let speciesCount = 0;
    for (const o of Sim.simlets) {
      if (o === s) continue;
      if (s.parents.includes(o.id)) { parents.push(o); roles.set(o, 'parent'); }
      else if (o.parents.includes(s.id)) { children.push(o); roles.set(o, 'child'); }
      else if (s.parents.length && o.parents.some(p => s.parents.includes(p))) { siblings.push(o); roles.set(o, 'sibling'); }
      if (o.species === s.species) speciesCount++;
    }
    const chips = (list, role) => list.length
      ? list.slice(0, 12).map(o => `<span class="chip" style="border-color:${HIGHLIGHT_COLORS[role]}" data-id="${o.id}">#${o.id}</span>`).join('') + (list.length > 12 ? ` <span class="muted">+${list.length - 12}</span>` : '')
      : '<span class="muted">none alive</span>';
    const deadParents = s.parents.filter(id => !parents.some(p => p.id === id)).map(id => `<span class="chip dead">#${id} †</span>`).join('');
    $('iFamily').innerHTML =
      `<div class="frow"><span>Parents</span><div>${s.parents.length ? chips(parents, 'parent') + deadParents : '<span class="muted">founder / newcomer</span>'}</div></div>` +
      `<div class="frow"><span>Children</span><div>${chips(children, 'child')}</div></div>` +
      `<div class="frow"><span>Siblings</span><div>${chips(siblings, 'sibling')}</div></div>` +
      `<div class="frow"><span>Species</span><div>S${s.species ? s.species.id : '–'} · ${speciesCount} others alive</div></div>`;
    if (mode === 'family') Render.highlight = { roles, self: s };
    else if (mode === 'species') {
      const r = new Map(); for (const o of Sim.simlets) if (o !== s && o.species === s.species) r.set(o, 'species');
      Render.highlight = { roles: r, self: s };
    } else Render.highlight = null;
  },

  // nothing selected: show the living species, biggest first
  renderSpeciesList() {
    const all = [...Species.live.values()].sort((a, b) => b.count - a.count);
    const list = all.filter(sp => sp.count >= P.speciesMinShown), small = all.filter(sp => sp.count < P.speciesMinShown);
    const smallN = small.reduce((a, sp) => a + sp.count, 0);
    const glyph = d => d < 0.33 ? '<b style="color:#199e70">●</b>' : d > 0.66 ? '<b style="color:#d95926">▲</b>' : '<b style="color:#3987e5">◆</b>';
    const rows = list.slice(0, 25).map(sp => `<div class="sprow"><i class="sw" style="background:${Species.color(sp)}"></i>` +
      `<b>S${sp.id}</b><span class="num">${sp.count}</span><span>${glyph(sp.dietMean)} ${sp.dietMean.toFixed(2)}</span>` +
      `<span class="muted">${sp.parent ? 'from S' + sp.parent : 'tribe'} · t${sp.born}</span></div>`).join('');
    $('inspector').innerHTML = `<p class="hint" style="margin:0 0 10px">Click a simlet to inspect its genome.</p>
      <h2 data-tip="A species is a cluster of genetically similar simlets (threshold set by the Species similarity slider under Evolution). When part of a species drifts too far from the rest, it splits off as a new species; 'from' shows which species it split from.">Species (${list.length} alive${small.length ? ` + ${small.length} small` : ''})</h2>
      <div class="sprow sphead"><i></i><span>ID</span><span class="num">Count</span><span>Diet</span><span>Origin</span></div>
      ${rows}${list.length > 25 ? `<p class="hint">+ ${list.length - 25} more species</p>` : ''}
      ${small.length ? `<div class="sprow" data-tip="Species with fewer than ${P.speciesMinShown} members (Smallest species listed slider, Evolution section), lumped together."><i class="sw" style="background:${OTHER_COLOR}"></i><b>Other</b><span class="num">${smallN}</span><span class="muted" style="grid-column: span 2">${small.length} small species</span></div>` : ''}`;
  },

  buildInspector(s) {
    const deg = r => Math.round(r * 180 / Math.PI);
    const tip = t => ` data-tip="${t.replace(/"/g, '&quot;')}"`;
    const row = (label, value, t, id) => `<div class="kvr"${tip(t)}><span>${label}</span><b${id ? ` id="${id}"` : ''}>${value}</b></div>`;
    let html = `
      <div class="insp-head"><div class="insp-sw" style="background:${s.color}"${tip('Colour is calculated from the whole genome, so relatives look alike and new species drift to new colours.')}></div>
        <div><h2>Simlet #${s.id}</h2><div class="muted"${tip('Generation = how many breeding steps since the founders (generation 0) were dropped in.')}>Generation ${s.gen}${s.parents.length === 2 ? ` · parents #${s.parents[0]}, #${s.parents[1]}` : s.parents.length === 1 ? ` · clone of #${s.parents[0]}` : s.origin === 'founder' ? ' · founder' : ` · ${s.origin}`}</div></div></div>
      <div class="insp-actions">
        <button class="btn sm" id="iFollow"></button>
        <button class="btn sm" id="iClose">Close</button>
      </div>
      <div class="insp-actions" data-tip="Highlight this simlet's relatives or its whole species on the map; everyone else fades. Gold = parents, teal = children, white = siblings, lilac = same species.">
        <span class="muted" style="align-self:center">Highlight:</span>
        <button class="btn sm hl" data-hl="none">Off</button>
        <button class="btn sm hl" data-hl="family">Family</button>
        <button class="btn sm hl" data-hl="species">Species</button>
      </div>
      <div id="iFamily" class="family"></div>
      <div id="iDead" class="dead-banner hidden"></div>
      <span id="iAction" class="doing"></span>
      <p class="hint">${matchMedia('(pointer: coarse)').matches ? 'Press and hold' : 'Hover'} any row for an explanation.</p>
      <h3>Vitals</h3>
      ${row('Species', '', 'Genetic cluster this simlet belongs to (see the species list when nothing is selected). Membership is re-checked every 50 ticks, so it can change if the population drifts.', 'iSpecies')}
      ${row('Status', '', 'What the events running now are doing to this simlet (for example sick). – = nothing.', 'iStatus')}
      ${row('Energy', '', 'Current / maximum energy. Food adds energy; everything else (existing, moving, fighting, breeding, farming) spends it. Zero = starves.', 'iEnergy')}
      <div class="meter"><div id="iEnergyBar" style="background:var(--herb)"></div></div>
      ${row('Stamina', '', 'Sprint meter: drains 1 per tick of sprinting, refills when not sprinting (twice as fast when resting). Empty = exhausted, no sprinting until 30% refilled.', 'iStam')}
      <div class="meter"><div id="iStamBar" style="background:var(--warn)"></div></div>
      ${row('Age', '', 'Age in ticks / maximum age (set by the Lifespan gene). Reaching the maximum = death of old age.', 'iAge')}
      <div class="meter"><div id="iAgeBar" style="background:var(--ink-3)"></div></div>
      ${row('Shelter', '', 'Inside a family shelter, or the nearest family shelter with its food store.', 'iShelter')}
      ${row('Children', '', 'Offspring born so far (as either parent).', 'iChildren')}
      ${row('Kills', '', 'Successful attacks. The victim becomes a corpse that meat-eaters can eat.', 'iKills')}
      ${row('Farmed', '', 'Times it spent energy planting food.', 'iFarmed')}
      ${row('Donations', '', 'Times it gave energy to a starving relative.', 'iDonated')}
      <h3>Body (derived from genes)</h3>
      ${row('Mass', s.mass.toFixed(2), 'Set by the Size gene (0.5 to 3). Sets energy capacity (40 × mass), idle drain, fighting strength and movement cost.')}
      ${row('Top speed / sprint', `${s.maxSpeed.toFixed(3)} / ${(s.maxSpeed * P.sprintMult).toFixed(3)}`, 'Tiles per tick when walking flat out / sprinting. Moving costs mass × speed², so sprinting is much dearer. Water halves speed.')}
      ${row('Sprint endurance', `${Math.round(s.staminaMax)} ticks · refill ${s.staminaRegen.toFixed(2)}/tick`, 'Full meter in ticks of sprinting, and how fast it refills (Stamina gene). Costs extra idle energy.')}
      ${row('Vision', `${deg(s.fovAngle)}° · ${s.visionRange.toFixed(1)} tiles`, 'Width and range of the vision cone. Every simlet sees the same area, so a wider cone means shorter range (FOV gene; range also reduced by camouflage). Range drops 40% at night and in forest. Anything within touching distance is sensed even outside the cone.')}
      ${row('Acuity', s.acuity.toFixed(2), 'Sharpness of vision. Higher acuity sees through other simlets\' camouflage. Wide FOV = low acuity.')}
      ${row('Digests plants / meat', `${(s.plantEff * 100).toFixed(0)}% / ${(s.meatEff * 100).toFixed(0)}%`, 'Share of a food item\'s energy it actually gets, set by the Diet gene.')}
      ${row('Eats when below', `${(s.hungerAt * 100).toFixed(0)}% energy`, 'Below this energy level, food becomes the priority (Hunger gene).')}
      ${row('Breeds when above', `${(s.breedAt * 100).toFixed(0)}% energy`, 'Must be above this energy level, mature, and off cooldown to look for a mate (Breed threshold gene).')}
      ${row('Max litter', s.brood, 'Most children per breeding (Brood size gene). The initiating parent\'s gene decides it.')}
      ${row('Reproduction', `${Math.round(s.g[G.sexuality] * 100)}% sexual`, 'Chance each breeding is sexual (Sexuality gene). Otherwise, or if no mate turns up within 300 ticks, it clones itself.')}
      ${row('Mate similarity ≥', `${(s.minMateSim * 100).toFixed(0)}%`, 'Minimum genetic similarity it accepts in a mate (Choosiness gene). Both partners must accept each other.')}
      ${row('Matures at', `${Math.round(s.matureAge)} ticks`, 'Age before it can breed. Bigger bodies take longer to grow up.')}`;
    if (Brain.mode === 'hybrid' && s.brain) {
      html += `<h3>Brain (hybrid)</h3>
        <p class="hint" style="margin:0 0 6px">Score at its last decision: rules + brain correction = final. Highest final wins.</p>
        <div class="brow bhead" data-tip="Rules = the score from the hand-written formulas. Brain = the learned correction added on top (n/a = action not possible right now). Final = Rules + Brain; the highest final wins and is highlighted."><span>Action</span><span>Rules</span><span>Brain</span><span>Final</span></div>
        ${BRAIN_OUT.map(k => `<div class="brow" id="br_${k}" data-tip="${BRAIN_ACTION_NAMES[k]}: ${(ACTION_TIPS[k] || '').replace(/"/g, '')}"><span>${k}</span><span>–</span><span>–</span><span>–</span></div>`).join('')}
        <h3 data-tip="Rough map of what this brain has learned: each cell is how strongly an input pushes an action up (orange) or down (blue). It ignores the network's non-linearity, so treat it as a sketch.">Brain wiring (input → action)</h3>
        ${this.brainHeatmap(s.brain)}`;
    }
    let group = null;
    GENES.forEach((gene, i) => {
      if (gene.group !== group) { group = gene.group; html += `<h3>${group}</h3>`; }
      const v = s.g[i];
      html += `<div class="gene"${tip(gene.tip)}><span class="gl">${gene.label}</span><div class="gb"><div style="width:${(v * 100).toFixed(1)}%"></div></div><span class="gv">${v.toFixed(2)}</span></div>`;
    });
    $('inspector').innerHTML = html;
    $('iFollow').onclick = () => { this.follow = !this.follow; this.updateInspector(s); };
    document.querySelectorAll('#inspector .hl').forEach(b => b.onclick = () => { this.hlMode = b.dataset.hl; this.updateInspector(s); });
    $('iFamily').onclick = e => {                            // click a relative's chip to jump to it
      const id = e.target.dataset && e.target.dataset.id; if (!id) return;
      const t = Sim.simlets.find(x => x.id === +id); if (t) { this.selected = t; this.renderInspector(true); }
    };
    $('iClose').onclick = () => { this.selected = null; this.follow = false; this.renderInspector(true); };
  },

  updateInspector(s) {
    const pct = (a, b) => (clamp(a / b, 0, 1) * 100).toFixed(1) + '%';
    $('iFollow').textContent = this.follow ? 'Unfollow' : 'Follow';
    this.updateFamily(s);
    const dead = $('iDead'), act = $('iAction');
    if (s.dead) {
      dead.textContent = `Died: ${s.cause} at tick ${s.diedAt}`; dead.classList.remove('hidden'); act.classList.add('hidden');
    } else {
      act.textContent = s.action.toUpperCase() + (s.sprinting && s.curSpeed > 0 ? ' · SPRINT' : '');
      act.dataset.tip = ACTION_TIPS[s.action] || '';
    }
    $('iEnergy').textContent = `${Math.max(0, s.energy).toFixed(1)} / ${s.maxEnergy.toFixed(0)}`;
    $('iEnergyBar').style.width = pct(s.energy, s.maxEnergy);
    $('iStam').textContent = `${Math.round(s.stam)} / ${Math.round(s.staminaMax)}${s.exhausted ? ' · exhausted' : ''}`;
    $('iStamBar').style.width = pct(s.stam, s.staminaMax);
    $('iAge').textContent = `${s.age} / ${Math.round(s.maxAge)}`;
    $('iAgeBar').style.width = pct(s.age, s.maxAge);
    const sp = s.species;
    $('iStatus').textContent = (!s.dead && Events.describe(s)) || '–';
    $('iSpecies').innerHTML = sp ? `<i class="sw" style="background:${Species.color(sp)};width:9px;height:9px"></i> S${sp.id}` : '–';
    if (Brain.mode === 'hybrid' && s.brain && s.baseScores && s.scores && $('br_eat')) {
      const f = v => v === -Infinity ? '–' : v.toFixed(2);
      for (let o = 0; o < NO; o++) {
        const k = BRAIN_OUT[o], el = $('br_' + k), base = s.baseScores[k], fin = s.scores[k];
        const corr = fin === -Infinity ? null : fin - base;
        el.children[1].textContent = fin === -Infinity ? 'n/a' : f(base);
        el.children[2].textContent = corr === null ? '' : (corr >= 0 ? '+' : '') + corr.toFixed(2);
        el.children[3].textContent = f(fin);
        el.classList.toggle('bwin', k === s.action);
      }
    }
    { const h = s.inShelter ? { sh: s.inShelter, d: 0 } : Shelters.nearestKin(s, sh => sh.done);
      $('iShelter').textContent = s.inShelter ? `inside · store ${Math.round(s.inShelter.store)}` : h ? `${h.d.toFixed(0)} tiles away · store ${Math.round(h.sh.store)}` : 'none nearby'; }
    $('iChildren').textContent = s.children; $('iKills').textContent = s.kills;
    $('iFarmed').textContent = s.farmed; $('iDonated').textContent = s.donated;
  },
};

// Plain-English labels for the brain heat-map
const BRAIN_INPUT_TIPS = {
  energy: 'Energy level (0 empty, 1 full)', hunger: 'How urgently it needs food', stamina: 'Sprint meter (0 empty, 1 full)',
  exhausted: 'Exhausted: sprint meter ran out (1 = yes)', threat: 'How threatening the scariest visible simlet is',
  threatNear: 'How close that threat is (1 = right here)', prey: 'How attractive the best visible prey is',
  preyNear: 'How close that prey is (1 = right here)', preySize: 'Prey size relative to itself (higher = bigger prey)',
  food: 'Value of the best visible food (net energy)', foodNear: 'How close that food is (1 = right here)',
  night: 'Darkness (0 noon, 1 midnight)', bust: 'Bust season (1 = bust, 0 = boom)', kin: 'Relatives nearby (1 = five or more)',
  ready: 'Ready to breed (1 = yes)', age: 'Age as a fraction of its maximum lifespan',
  timeToBust: 'In boom: how much of the boom is left (1 = just started, 0 = bust is coming). 0 during bust',
  timeToBoom: 'In bust: how much of the bust is left (1 = just started, 0 = boom is coming). 0 during boom',
  shelterNear: 'A family shelter with room is nearby (1 = right here)', storeFull: 'How full the nearest family food store is', buildSite: 'There is somewhere to build or repair nearby (1 = yes)',
  scent: 'Strength of plant-eater scent it can smell ahead (0 = nothing, or too faint for its nose)',
  inForest: 'Standing in forest (1 = yes): cover, shelter from winter cold, shorter sight',
  onWater: 'Standing in open water (1 = yes; ice does not count)',
  freshSoil: 'Standing on farmable land with fresh (non-exhausted) soil (1 = yes)',
  bias: 'Constant input that is always 1: the brain\'s default leaning, whatever the situation',
};
const BRAIN_ACTION_NAMES = {
  flee: 'Flee', hunt: 'Hunt', eat: 'Eat', recall: 'Go to remembered food', breed: 'Seek a mate',
  clone: 'Clone (asexual breeding)', farm: 'Farm', rest: 'Rest', wander: 'Wander', track: 'Track a scent trail', build: 'Build / repair shelter', shelter: 'Go inside shelter', draw: 'Eat from family store',
};

// What the simlet is currently doing (the action that scored highest at its last decision)
const ACTION_TIPS = {
  wander: 'Exploring: nothing more urgent scored higher. Smooth roaming, faster when hungry.',
  eat: 'Heading to (or eating) the best food it can see.',
  recall: 'Heading back to a food spot it remembers.',
  hunt: 'Chasing a simlet to attack it.',
  flee: 'Running from a threat it can see, or one a relative warned it about.',
  breed: 'Approaching a compatible mate.',
  sow: 'Walking to fresh soil to plant: the ground here is exhausted.',
  build: 'Building or repairing a family shelter (paying energy, 40 ticks per work session).',
  shelter: 'Inside (or heading to) a family shelter: very low energy drain, no winter cold, hidden from predators.',
  draw: 'Eating from the family food store in a shelter.',
  track: 'Following a plant-eater scent trail towards where the herd went.',
  clone: 'Reproducing asexually: budding off mutated copies of itself.',
  farm: 'Planting food: spent energy, now waiting while it grows.',
  rest: 'Resting to save energy. Idle drain is cut and camouflage stays intact.',
};
