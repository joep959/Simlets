'use strict';
// Side panels: transport controls, map editor, parameter sliders, inspector. Mouse/keyboard on the map.

const SPEEDS = [0.25, 0.5, 1, 2, 4, 8, 16, 32, 64, 128, 'Max'];   // ticks per frame
const $ = id => document.getElementById(id);

const UI = {
  running: true, speedIdx: 2, mode: 'run', brush: TERRAIN.FERTILE, brushSize: 3,
  selected: null, follow: false, tps: 0, dropArmed: false,

  init() {
    // transport
    $('btnPlay').onclick = () => this.setRunning(!this.running);
    $('btnStep').onclick = () => { this.setRunning(false); Sim.step(); };
    $('speed').oninput = e => { this.speedIdx = +e.target.value; $('speedLbl').textContent = this.speedLabel(); };
    $('speedLbl').textContent = this.speedLabel();

    // mode + editor
    $('modeRun').onclick = () => this.setMode('run');
    $('modeEdit').onclick = () => this.setMode('edit');
    const bw = $('brushes');
    TERRAIN_INFO.forEach((t, i) => {
      const b = document.createElement('button');
      b.className = 'brush' + (i === this.brush ? ' on' : '');
      b.innerHTML = `<i class="sw" style="background:${t.color}"></i>${t.name}`;
      b.onclick = () => { this.brush = i; [...bw.children].forEach((c, j) => c.classList.toggle('on', j === i)); };
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
    $('btnDrop').onclick = () => this.armDrop(!this.dropArmed);
    $('btnReseed').onclick = $('btnReseed2').onclick = () => this.reseed();

    $('colorBy').onclick = () => {
      Render.colorBy = { diet: 'species', species: 'lineage', lineage: 'diet' }[Render.colorBy];
      $('colorBy').textContent = 'Colour: ' + Render.colorBy;
    };
    $('colorBy').dataset.tip = 'Click to cycle. Diet: green = herbivore, blue = omnivore, orange = carnivore. Species: each genetic cluster gets its own colour (grey = small species). Lineage: colour calculated straight from the genome, so close relatives share a hue. Shape always shows diet.';
    this.buildParams();
    this.initTips();
    this.bindMap();
    window.addEventListener('keydown', e => {
      if (e.code === 'Escape') this.armDrop(false);
      if (e.code === 'Space' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'SELECT') { e.preventDefault(); this.setRunning(!this.running); }
    });
  },

  armDrop(on) {
    if (on && this.mode !== 'run') this.setMode('run');
    this.dropArmed = on;
    $('btnDrop').classList.toggle('armed', on);
    $('btnDrop').textContent = on ? 'Click the map to drop… (Esc)' : 'Air-drop tribe…';
    $('map').style.cursor = on ? 'copy' : this.mode === 'edit' ? 'cell' : 'crosshair';
  },
  speedLabel() { const s = SPEEDS[this.speedIdx]; return s === 'Max' ? 'Max' : '×' + s; },
  setRunning(r) { this.running = r; $('btnPlay').textContent = r ? '❚❚ Pause' : '▶ Play'; },
  setMode(m) {
    this.mode = m;
    $('modeRun').classList.toggle('on', m === 'run'); $('modeEdit').classList.toggle('on', m === 'edit');
    $('editTools').classList.toggle('hidden', m !== 'edit');
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
    const root = $('params'); let section = null, det = null;
    const reset = document.createElement('button');
    reset.className = 'btn wide'; reset.style.margin = '0 0 8px'; reset.textContent = 'Restore default settings';
    reset.onclick = () => {
      for (const d of PARAM_DEFS) { P[d[1]] = d[6]; this.paramInputs[d[1]](); }
    };
    root.appendChild(reset);
    this.paramInputs = {};
    for (const [sec, key, label, min, max, step] of PARAM_DEFS) {
      if (sec !== section) {
        section = sec; det = document.createElement('details');
        det.innerHTML = `<summary>${sec}${sec === 'Population' ? ' <span class="muted">(applies on restart)</span>' : ''}</summary>`;
        root.appendChild(det);
      }
      const wrap = document.createElement('div'); wrap.className = 'param';
      wrap.innerHTML = `<label class="lbl" data-tip="${PARAM_TIPS[key] || ''}">${label} <span class="val"></span></label><input type="range" min="${min}" max="${max}" step="${step}">`;
      const inp = wrap.querySelector('input'), val = wrap.querySelector('.val');
      inp.value = P[key]; val.textContent = P[key];
      inp.oninput = () => { P[key] = +inp.value; val.textContent = inp.value; };
      this.paramInputs[key] = () => { inp.value = P[key]; val.textContent = P[key]; };   // refresh after restore
      det.appendChild(wrap);
    }
  },

  // ---- map mouse handling: wheel zoom, drag pan, click select, paint in edit mode ----
  bindMap() {
    const c = $('map'); let drag = null;
    c.addEventListener('contextmenu', e => e.preventDefault());
    c.addEventListener('wheel', e => {
      e.preventDefault();
      const r = c.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
      const [wx, wy] = Render.toWorld(px, py);
      Render.cam.zoom = clamp(Render.cam.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), 1, 60);
      const [nx, ny] = Render.toWorld(px, py);       // keep the point under the cursor fixed
      Render.cam.x += wx - nx; Render.cam.y += wy - ny;
    }, { passive: false });
    c.addEventListener('mousedown', e => {
      const r = c.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
      const paint = this.mode === 'edit' && e.button === 0;
      drag = { px, py, sx: px, sy: py, moved: false, paint };
      if (paint) this.paintAt(px, py);
    });
    window.addEventListener('mousemove', e => {
      if (!drag) return;
      const r = c.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
      if (Math.hypot(px - drag.sx, py - drag.sy) > 4) drag.moved = true;
      if (drag.paint) this.paintAt(px, py);
      else {
        Render.cam.x -= (px - drag.px) / Render.cam.zoom; Render.cam.y -= (py - drag.py) / Render.cam.zoom;
        if (drag.moved) this.follow = false;
      }
      drag.px = px; drag.py = py;
    });
    window.addEventListener('mouseup', () => {
      if (drag && !drag.moved && !drag.paint && this.mode === 'run' && this.dropArmed) {
        const [x, y] = Render.toWorld(drag.sx, drag.sy);
        if (x > 0 && y > 0 && x < WORLD_W && y < WORLD_H) Sim.dropTribe(x, y, 'air-drop');
        this.armDrop(false);
      } else if (drag && !drag.moved && !drag.paint && this.mode === 'run') {
        this.selected = Render.pick(drag.sx, drag.sy);
        this.renderInspector(true);
      }
      if (drag && drag.paint) this.mapChanged();
      drag = null;
    });
  },
  paintAt(px, py) {
    const [x, y] = Render.toWorld(px, py);
    World.paint(x, y, this.brushSize, this.brush);
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
    const rows = [
      ['Population', Sim.simlets.length], ['Herbivores', h], ['Omnivores', o], ['Carnivores', c],
      ['Food items', Food.count], ['Births', Sim.births], ['↳ sexual / asexual', `${Sim.birthsSex.toLocaleString()} / ${Sim.birthsAsex.toLocaleString()}`], ['Starved', Sim.deaths.starved],
      ['Killed', Sim.deaths.killed], ['Old age', Sim.deaths.old], ['Alarms raised', Sim.alarms],
      ['Farming acts', Sim.farmEvents], ['Newcomer tribes', Sim.arrivals], ['Species alive', Species.live.size], ...(Brain.mode === 'hybrid' ? [['Brain influence', Sim.brainInfluence.toFixed(3)]] : []), ['Species extinct', Species.extinctCount], ['Ticks / sec', Math.round(this.tps)],
    ];
    $('stats').innerHTML = rows.map(([k, v]) => `<span>${k}</span><b>${v.toLocaleString()}</b>`).join('');
    $('extinct').classList.toggle('hidden', Sim.simlets.length > 0 || Sim.tick === 0 || this.mode === 'edit');
  },

  // ---- hover explanations: any element with data-tip shows a floating note ----
  initTips() {
    const tip = $('itip');
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
    if (!s) { this._insp = null; this.renderSpeciesList(); return; }
    if (force || this._insp !== s) { this.buildInspector(s); this._insp = s; }
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
    return `<div class="bheat"><span></span>${BRAIN_OUT.map(k => `<b${tip('Column: ' + BRAIN_ACTION_NAMES[k])}>${k.slice(0, 3)}</b>`).join('')}` +
      m.map((r, i) => `<span${tip('Row input: ' + BRAIN_INPUT_TIPS[BRAIN_IN[i]])}>${BRAIN_IN[i]}</span>${[...r].map((v, o) => cell(v, i, o)).join('')}`).join('') +
      `</div><p class="hint" style="margin-top:6px"><b style="color:#d95926">■</b> raises the action · <b style="color:#3987e5">■</b> lowers it · stronger colour = stronger effect, relative to this brain's strongest link${mx > 0 ? ` (${mx.toFixed(2)})` : ''}. Blank = no effect. Hover a cell for details.</p>`;
  },

  // nothing selected: show the living species, biggest first
  renderSpeciesList() {
    const list = [...Species.live.values()].sort((a, b) => b.count - a.count);
    const glyph = d => d < 0.33 ? '<b style="color:#199e70">●</b>' : d > 0.66 ? '<b style="color:#d95926">▲</b>' : '<b style="color:#3987e5">◆</b>';
    const rows = list.slice(0, 25).map(sp => `<div class="sprow"><i class="sw" style="background:${Species.color(sp)}"></i>` +
      `<b>S${sp.id}</b><span class="num">${sp.count}</span><span>${glyph(sp.dietMean)} ${sp.dietMean.toFixed(2)}</span>` +
      `<span class="muted">${sp.parent ? 'from S' + sp.parent : 'tribe'} · t${sp.born}</span></div>`).join('');
    $('inspector').innerHTML = `<p class="hint" style="margin:0 0 10px">Click a simlet to inspect its genome.</p>
      <h2 data-tip="A species is a cluster of genetically similar simlets (threshold set by the Species similarity slider under Evolution). When part of a species drifts too far from the rest, it splits off as a new species; 'from' shows which species it split from.">Species (${list.length} alive)</h2>
      <div class="sprow sphead"><i></i><span>ID</span><span class="num">Count</span><span>Diet</span><span>Origin</span></div>
      ${rows}${list.length > 25 ? `<p class="hint">+ ${list.length - 25} smaller species</p>` : ''}`;
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
      <div id="iDead" class="dead-banner hidden"></div>
      <span id="iAction" class="doing"></span>
      <p class="hint">Hover any row for an explanation.</p>
      <h3>Vitals</h3>
      ${row('Species', '', 'Genetic cluster this simlet belongs to (see the species list when nothing is selected). Membership is re-checked every 50 ticks, so it can change if the population drifts.', 'iSpecies')}
      ${row('Energy', '', 'Current / maximum energy. Food adds energy; everything else (existing, moving, fighting, breeding, farming) spends it. Zero = starves.', 'iEnergy')}
      <div class="meter"><div id="iEnergyBar" style="background:var(--herb)"></div></div>
      ${row('Stamina', '', 'Sprint meter: drains 1 per tick of sprinting, refills when not sprinting (twice as fast when resting). Empty = exhausted, no sprinting until 30% refilled.', 'iStam')}
      <div class="meter"><div id="iStamBar" style="background:var(--warn)"></div></div>
      ${row('Age', '', 'Age in ticks / maximum age (set by the Lifespan gene). Reaching the maximum = death of old age.', 'iAge')}
      <div class="meter"><div id="iAgeBar" style="background:var(--ink-3)"></div></div>
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
    $('iClose').onclick = () => { this.selected = null; this.follow = false; this.renderInspector(true); };
  },

  updateInspector(s) {
    const pct = (a, b) => (clamp(a / b, 0, 1) * 100).toFixed(1) + '%';
    $('iFollow').textContent = this.follow ? 'Unfollow' : 'Follow';
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
  bias: 'Constant input that is always 1: the brain\'s default leaning, whatever the situation',
};
const BRAIN_ACTION_NAMES = {
  flee: 'Flee', hunt: 'Hunt', eat: 'Eat', recall: 'Go to remembered food', breed: 'Seek a mate',
  clone: 'Clone (asexual breeding)', farm: 'Farm', rest: 'Rest', wander: 'Wander',
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
  clone: 'Reproducing asexually: budding off mutated copies of itself.',
  farm: 'Planting food: spent energy, now waiting while it grows.',
  rest: 'Resting to save energy. Idle drain is cut and camouflage stays intact.',
};
