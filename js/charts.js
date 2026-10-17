'use strict';
// Three small live charts under the map, each with a hover crosshair/tooltip.

const COL = { ink2: '#a9a8a0', ink3: '#6f6e68', grid: '#24272c', herb: '#199e70', omni: '#3987e5', carn: '#d95926', accent: '#3987e5' };
const PAD = { l: 34, r: 8, t: 6, b: 16 };

const Charts = {
  pop: null, gene: null, diet: null, geneIdx: G.diet, hover: null, tip: null,

  init() {
    this.tip = document.getElementById('tip');
    for (const [key, id] of [['pop', 'chartPop'], ['species', 'chartSpecies'], ['gene', 'chartGene'], ['diet', 'chartDiet']]) {
      const c = document.getElementById(id);
      this[key] = { c, ctx: c.getContext('2d'), w: 0, h: 0 };
      c.addEventListener('mousemove', e => { const r = c.getBoundingClientRect(); this.hover = { key, x: e.clientX - r.left, cx: e.clientX, cy: e.clientY }; });
      c.addEventListener('mouseleave', () => { this.hover = null; this.tip.classList.add('hidden'); });
    }
    const sel = document.getElementById('geneSel');
    GENES.forEach((g, i) => { const o = document.createElement('option'); o.value = i; o.textContent = g.label; sel.appendChild(o); });
    sel.value = this.geneIdx;
    sel.onchange = () => { this.geneIdx = +sel.value; };
    this.resize();
    // re-fit whenever a chart panel changes size (legend wrapping, layout shifts), not just on window resize
    const ro = new ResizeObserver(() => { this.resize(); this.draw(); });
    for (const k of ['pop', 'species', 'gene', 'diet']) ro.observe(this[k].c.parentElement);
  },

  resize() {
    const dpr = window.devicePixelRatio || 1;
    for (const k of ['pop', 'species', 'gene', 'diet']) {
      const ch = this[k], r = ch.c.getBoundingClientRect();
      ch.w = r.width; ch.h = r.height; ch.dpr = dpr;
      ch.c.width = Math.round(r.width * dpr); ch.c.height = Math.round(r.height * dpr);
    }
  },

  frame(ch, ymax, yfmt) {
    const { ctx, w, h } = ch;
    ctx.setTransform(ch.dpr, 0, 0, ch.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.font = '10px Segoe UI, sans-serif'; ctx.fillStyle = COL.ink3; ctx.textAlign = 'right';
    ctx.strokeStyle = COL.grid; ctx.lineWidth = 1;
    for (const f of [0, 0.5, 1]) {
      const y = PAD.t + (h - PAD.t - PAD.b) * (1 - f);
      ctx.beginPath(); ctx.moveTo(PAD.l, y + 0.5); ctx.lineTo(w - PAD.r, y + 0.5); ctx.stroke();
      ctx.fillText(yfmt(ymax * f), PAD.l - 4, y + 3);
    }
  },

  // x position of tick t: charts are plotted against time, since sample spacing can change (history window, halving)
  X(ch, t) { const [t0, t1] = this.span; return PAD.l + (ch.w - PAD.l - PAD.r) * (t - t0) / (t1 - t0); },

  line(ch, xs, ys, ymax, color) {
    const { ctx, h } = ch, n = xs.length;
    if (n < 2) return;
    const ph = h - PAD.t - PAD.b;
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = this.X(ch, xs[i]), y = PAD.t + ph * (1 - ys[i] / ymax);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
  },

  xLabels(ch, t) {
    const { ctx, w, h } = ch;
    ctx.fillStyle = COL.ink3; ctx.font = '10px Segoe UI, sans-serif';
    ctx.textAlign = 'left'; ctx.fillText(`t ${t[0] ?? 0}`, PAD.l, h - 3);
    ctx.textAlign = 'right'; ctx.fillText(`t ${t[t.length - 1] ?? 0}`, w - PAD.r, h - 3);
  },

  hoverIndex(ch, t) {                                     // index of the sample nearest the mouse, by time
    if (!this.hover || this.hover.key !== ch.key || t.length < 2) return -1;
    let best = 0;
    for (let i = 1; i < t.length; i++) if (Math.abs(this.X(ch, t[i]) - this.hover.x) < Math.abs(this.X(ch, t[best]) - this.hover.x)) best = i;
    return best;
  },
  crosshair(ch, t) {
    const x = this.X(ch, t);
    ch.ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ch.ctx.lineWidth = 1;
    ch.ctx.beginPath(); ch.ctx.moveTo(x + 0.5, PAD.t); ch.ctx.lineTo(x + 0.5, ch.h - PAD.b); ch.ctx.stroke();
  },
  showTip(html) {
    this.tip.innerHTML = html; this.tip.classList.remove('hidden');
    this.tip.style.left = (this.hover.cx + 12) + 'px';
    this.tip.style.top = (this.hover.cy - this.tip.offsetHeight - 8) + 'px';
  },

  draw() {
    const H = Sim.history; if (!H) return;
    let tipShown = false;
    const t0 = H.t[0] ?? 0; this.span = [t0, Math.max(t0 + 1, H.t[H.t.length - 1] ?? 0)];

    // Population
    {
      const ch = this.pop; ch.key = 'pop';
      const ymax = Math.max(10, ...H.pop) * 1.1;
      this.frame(ch, ymax, v => Math.round(v));
      this.line(ch, H.t, H.pop, ymax, COL.ink2);
      this.line(ch, H.t, H.herb, ymax, COL.herb);
      this.line(ch, H.t, H.omni, ymax, COL.omni);
      this.line(ch, H.t, H.carn, ymax, COL.carn);
      this.xLabels(ch, H.t);
      const i = this.hoverIndex(ch, H.t);
      if (i >= 0) {
        this.crosshair(ch, H.t[i]);
        this.showTip(`<span class="k">tick</span> ${H.t[i]}<br>Total <b>${H.pop[i]}</b><br>Herbivore <b>${H.herb[i]}</b><br>Omnivore <b>${H.omni[i]}</b><br>Carnivore <b>${H.carn[i]}</b><br><span class="k">food items</span> ${H.food[i]}`);
        tipShown = true;
      }
    }

    // Species over time: stacked bands, one per coloured species, plus grey "Other"
    {
      const ch = this.species; ch.key = 'species';
      const S = H.species, n = S.length;
      const order = [];                                   // coloured species ever seen, oldest first
      const seen = new Set();
      for (const snap of S) for (const [id] of snap) {
        const m = Species.meta.get(id);
        if (m && m.slot >= 0 && !seen.has(id)) { seen.add(id); order.push(id); }
      }
      order.sort((a, b) => a - b);
      const rowOf = new Map(order.map((id, k) => [id, k]));
      const rows = order.map(() => new Float64Array(n)), other = new Float64Array(n), total = new Float64Array(n);
      for (let i = 0; i < n; i++) for (const [id, c] of S[i]) {
        const k = rowOf.get(id);
        if (k === undefined) other[i] += c; else rows[k][i] = c;
        total[i] += c;
      }
      const ymax = Math.max(10, ...total) * 1.1;
      this.frame(ch, ymax, v => Math.round(v));
      if (n >= 2) {
        const { ctx, h } = ch, ph = h - PAD.t - PAD.b;
        const X = i => this.X(ch, H.t[i]), Y = v => PAD.t + ph * (1 - v / ymax);
        const base = new Float64Array(n);
        const bands = rows.map((r, k) => [r, SPECIES_COLORS[Species.meta.get(order[k]).slot]]);
        bands.push([other, OTHER_COLOR]);
        for (const [vals, color] of bands) {
          ctx.fillStyle = color;
          ctx.beginPath();
          for (let i = 0; i < n; i++) ctx.lineTo(X(i), Y(base[i] + vals[i]));
          for (let i = n - 1; i >= 0; i--) ctx.lineTo(X(i), Y(base[i]));
          ctx.closePath(); ctx.fill();
          for (let i = 0; i < n; i++) base[i] += vals[i];
        }
      }
      this.xLabels(ch, H.t);
      // legend: living coloured species
      const leg = [...Species.live.values()].filter(sp => sp.slot >= 0).sort((a, b) => a.id - b.id)
        .map(sp => `<span><i class="sw" style="background:${SPECIES_COLORS[sp.slot]};width:9px;height:9px"></i>S${sp.id}</span>`).join('')
        + `<span><i class="sw" style="background:${OTHER_COLOR};width:9px;height:9px"></i>Other</span>`;
      if (leg !== this._spLeg) { document.getElementById('spLegend').innerHTML = leg; this._spLeg = leg; }
      const i = this.hoverIndex(ch, H.t);
      if (i >= 0) {
        this.crosshair(ch, H.t[i]);
        const top = [...S[i]].sort((a, b) => b[1] - a[1]).slice(0, 6);
        this.showTip(`<span class="k">tick</span> ${H.t[i]} · <b>${S[i].length}</b> species<br>` +
          top.map(([id, c]) => `S${id} <b>${c}</b>`).join('<br>') + (S[i].length > 6 ? '<br><span class="k">…</span>' : ''));
        tipShown = true;
      }
    }

    // Mean gene ± 1 sd
    {
      const ch = this.gene; ch.key = 'gene';
      const gi = this.geneIdx, n = H.t.length;
      this.frame(ch, 1, v => v.toFixed(1));
      if (n >= 2) {
        const { ctx, h } = ch, ph = h - PAD.t - PAD.b;
        ctx.fillStyle = 'rgba(57,135,229,0.22)';
        ctx.beginPath();
        for (let i = 0; i < n; i++) ctx.lineTo(this.X(ch, H.t[i]), PAD.t + ph * (1 - clamp(H.mean[i][gi] + H.sd[i][gi], 0, 1)));
        for (let i = n - 1; i >= 0; i--) ctx.lineTo(this.X(ch, H.t[i]), PAD.t + ph * (1 - clamp(H.mean[i][gi] - H.sd[i][gi], 0, 1)));
        ctx.closePath(); ctx.fill();
        this.line(ch, H.t, H.mean.map(m => m[gi]), 1, COL.accent);
      }
      this.xLabels(ch, H.t);
      const i = this.hoverIndex(ch, H.t);
      if (i >= 0) {
        this.crosshair(ch, H.t[i]);
        this.showTip(`<span class="k">tick</span> ${H.t[i]}<br>${GENES[gi].label}: mean <b>${H.mean[i][gi].toFixed(2)}</b> ± ${H.sd[i][gi].toFixed(2)}`);
        tipShown = true;
      }
    }

    // Diet histogram (current population)
    {
      const ch = this.diet; ch.key = 'diet';
      const bins = new Array(20).fill(0);
      for (const s of Sim.simlets) bins[Math.min(19, (s.g[G.diet] * 20) | 0)]++;
      const ymax = Math.max(5, ...bins) * 1.1;
      this.frame(ch, ymax, v => Math.round(v));
      const { ctx, w, h } = ch, pw = w - PAD.l - PAD.r, ph = h - PAD.t - PAD.b, bw = pw / 20;
      let hi = -1;
      if (this.hover && this.hover.key === 'diet') hi = clamp(Math.floor((this.hover.x - PAD.l) / bw), 0, 19);
      for (let b = 0; b < 20; b++) {
        const c = (b + 0.5) / 20;
        ctx.fillStyle = c < 0.33 ? COL.herb : c > 0.66 ? COL.carn : COL.omni;
        ctx.globalAlpha = hi === -1 || hi === b ? 1 : 0.55;
        const bh = ph * bins[b] / ymax, x = PAD.l + b * bw + 1, y = PAD.t + ph - bh;
        if (bh > 0) { ctx.beginPath(); ctx.roundRect(x, y, bw - 2, bh, [2, 2, 0, 0]); ctx.fill(); }
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = COL.ink3; ctx.font = '10px Segoe UI, sans-serif';
      ctx.textAlign = 'left'; ctx.fillText('0 plants', PAD.l, h - 3);
      ctx.textAlign = 'right'; ctx.fillText('1 meat', w - PAD.r, h - 3);
      if (hi >= 0) { this.showTip(`Diet ${(hi / 20).toFixed(2)}–${((hi + 1) / 20).toFixed(2)}: <b>${bins[hi]}</b> simlets`); tipShown = true; }
    }

    if (!tipShown) this.tip.classList.add('hidden');
  },
};
