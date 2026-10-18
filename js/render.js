'use strict';
// Draws terrain, food and simlets onto the map canvas. Camera = pan + zoom (pixels per tile).

const TILE_PX = 6;
const HIGHLIGHT_COLORS = { parent: '#f2c94c', child: '#4fd1c5', sibling: '#ffffff', species: '#c9a7ff' };
const DIET_COLORS = ['#199e70', '#3987e5', '#d95926'];   // herbivore, omnivore, carnivore (same as charts)   // resolution of the cached terrain image
const Render = {
  canvas: null, ctx: null, terrainCanvas: null,
  cam: { x: WORLD_W / 2, y: WORLD_H / 2, zoom: 5 },   // centre of view (tiles) and pixels per tile
  dpr: 1, w: 0, h: 0,
  colorBy: 'species',
  showScent: false, scentCanvas: null, scentFrame: 0,
  highlight: null,   // { roles: Map(simlet -> 'parent'|'child'|'sibling'|'species'), self } set by the inspector   // 'diet' = herbivore/omnivore/carnivore, 'lineage' = colour from genome, 'species' = cluster colour

  init(canvas) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d');
    this.terrainCanvas = document.createElement('canvas');
    this.terrainCanvas.width = WORLD_W * TILE_PX; this.terrainCanvas.height = WORLD_H * TILE_PX;
    this.resize(); this.fit();
  },
  resize() {
    this.dpr = window.devicePixelRatio || 1;
    const r = this.canvas.getBoundingClientRect();
    this.w = r.width; this.h = r.height;
    this.canvas.width = Math.round(r.width * this.dpr); this.canvas.height = Math.round(r.height * this.dpr);
  },
  fit() {
    this.cam.zoom = Math.min(this.w / WORLD_W, this.h / WORLD_H) * 0.98;
    this.cam.x = WORLD_W / 2; this.cam.y = WORLD_H / 2;
  },
  toScreen(x, y) { return [(x - this.cam.x) * this.cam.zoom + this.w / 2, (y - this.cam.y) * this.cam.zoom + this.h / 2]; },
  toWorld(px, py) { return [(px - this.w / 2) / this.cam.zoom + this.cam.x, (py - this.h / 2) / this.cam.zoom + this.cam.y]; },

  // cached terrain image: fully rebuilt when the map changes, otherwise only tiles whose look changed are repainted
  rebuildTerrain() {
    const c = this.terrainCanvas.getContext('2d');
    for (let y = 0; y < WORLD_H; y++) for (let x = 0; x < WORLD_W; x++) this.drawTile(c, x, y);
    World.dirty = false; World.redraw.length = 0;
  },
  drawTile(c, x, y) {
    const i = y * WORLD_W + x, t = World.terrain[i], px = x * TILE_PX, py = y * TILE_PX;
    c.fillStyle = TERRAIN_INFO[t].color;
    c.fillRect(px, py, TILE_PX, TILE_PX);
    const h = ((x * 73856093) ^ (y * 19349663)) >>> 0;
    if (t === TERRAIN.WATER) {
      if (h % 5 === 0) { c.fillStyle = 'rgba(255,255,255,0.06)'; c.fillRect(px + 1, py + 2, 3, 1); }
      return;
    }
    const soilLvl = Math.min(3, (World.soil[i] * 4) | 0), tr = World.trees[i];
    if (t === TERRAIN.FOREST) {                     // denser forest = darker
      c.fillStyle = `rgba(15,35,20,${(0.35 * (tr - 0.4)).toFixed(2)})`; c.fillRect(px, py, TILE_PX, TILE_PX);
      c.fillStyle = 'rgba(20,45,25,0.45)';
      c.beginPath(); c.arc(px + (h % 4) + 1, py + ((h >> 3) % 4) + 1, 1.6, 0, 7); c.fill();
      return;
    }
    // richer soil = greener; grassland close to turning fertile shows a green tinge
    if (t === TERRAIN.FERTILE) { if (soilLvl < 3) { c.fillStyle = 'rgba(214,207,152,0.25)'; c.fillRect(px, py, TILE_PX, TILE_PX); } }
    else if (soilLvl >= 2) { c.fillStyle = `rgba(106,168,79,${soilLvl === 3 ? 0.3 : 0.12})`; c.fillRect(px, py, TILE_PX, TILE_PX); }
    if (h % 3 === 0) { c.fillStyle = 'rgba(0,0,0,0.05)'; c.fillRect(px + (h % 5), py + ((h >> 4) % 5), 1, 1); }
    if (tr >= 0.2) {                                // saplings: young trees creeping in from a forest edge
      c.fillStyle = `rgba(45,85,50,${(0.3 + tr).toFixed(2)})`;
      c.beginPath(); c.arc(px + (h % 4) + 1, py + ((h >> 3) % 4) + 1, 0.6 + 1.2 * tr, 0, 7); c.fill();
    }
  },

  draw(selected, editMode) {
    if (World.dirty) this.rebuildTerrain();
    else if (World.redraw.length) {
      const c = this.terrainCanvas.getContext('2d');
      for (const i of World.redraw) this.drawTile(c, i % WORLD_W, (i / WORLD_W) | 0);
      World.redraw.length = 0;
    }
    const ctx = this.ctx, z = this.cam.zoom, tick = Sim.tick;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#0b0c0e'; ctx.fillRect(0, 0, this.w, this.h);

    // terrain (desaturated in bust season)
    const bust = World.season(tick) === 1;
    const [ox, oy] = this.toScreen(0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.filter = bust ? 'saturate(60%)' : 'none';
    ctx.drawImage(this.terrainCanvas, ox, oy, WORLD_W * z, WORLD_H * z);
    ctx.filter = 'none';

    // scent overlay: one pixel per tile, rebuilt every 10 frames, drawn scaled over the map
    if (this.showScent) {
      if (!this.scentCanvas) { this.scentCanvas = document.createElement('canvas'); this.scentCanvas.width = WORLD_W; this.scentCanvas.height = WORLD_H; }
      if (this.scentFrame++ % 10 === 0) {
        const sc = this.scentCanvas.getContext('2d'), img = sc.createImageData(WORLD_W, WORLD_H), d = img.data;
        for (let i = 0; i < World.scent.length; i++) {
          const v = World.scent[i]; if (v <= 0.02) continue;
          d[i * 4] = 150; d[i * 4 + 1] = 60; d[i * 4 + 2] = 220; d[i * 4 + 3] = Math.min(220, 40 + v * 120);
        }
        sc.putImageData(img, 0, 0);
      }
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.scentCanvas, ox, oy, WORLD_W * z, WORLD_H * z);
      ctx.imageSmoothingEnabled = false;
    }

    // ice: frozen water drawn pale blue-white with a faint crack line
    for (const ti of World.iceTiles) {
      const tx = ti % WORLD_W, ty = (ti / WORLD_W) | 0;
      const [px, py] = this.toScreen(tx, ty);
      if (px < -z || py < -z || px > this.w || py > this.h) continue;
      ctx.fillStyle = 'rgba(222,238,248,0.88)';
      ctx.fillRect(px, py, z + 0.5, z + 0.5);
      if (z >= 6 && (ti * 2654435761 >>> 28) === 0) {
        ctx.strokeStyle = 'rgba(140,170,195,0.7)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(px + z * 0.2, py + z * 0.3); ctx.lineTo(px + z * 0.8, py + z * 0.7); ctx.stroke();
      }
    }

    // floodwater (events): flooded land drawn as shallow, slightly brown water with a faint ripple
    for (const ti of World.floodTiles) {
      const tx = ti % WORLD_W, ty = (ti / WORLD_W) | 0;
      const [px, py] = this.toScreen(tx, ty);
      if (px < -z || py < -z || px > this.w || py > this.h) continue;
      ctx.fillStyle = 'rgba(92,140,176,0.62)';
      ctx.fillRect(px, py, z + 0.5, z + 0.5);
      if (z >= 6 && (ti * 2654435761 >>> 29) === 0) { ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(px + z * 0.2, py + z * 0.4, z * 0.5, 1); }
    }

    // fallow: exhausted soil (below SOIL_MIN) drawn pale and dusty until it recovers
    for (const ti of World.depleted) {
      const tx = ti % WORLD_W, ty = (ti / WORLD_W) | 0;
      const [px, py] = this.toScreen(tx, ty);
      if (px < -z || py < -z || px > this.w || py > this.h) continue;
      ctx.fillStyle = `rgba(138,124,108,${(0.8 - World.soil[ti] * 1.5).toFixed(2)})`;   // dusty grey-brown
      ctx.fillRect(px, py, z + 0.5, z + 0.5);
      if (z >= 5) {                                                                    // stipple so it reads as bare earth
        ctx.fillStyle = 'rgba(90,78,66,0.6)';
        ctx.fillRect(px + z * 0.25, py + z * 0.3, 1, 1); ctx.fillRect(px + z * 0.7, py + z * 0.65, 1, 1);
      }
    }

    // farmland: tiles farmed in the last 4000 ticks drawn as tilled brown soil with furrows
    const tz = z;
    for (const [ti, t] of World.tilled) {
      if (tick - t > 4000) { World.tilled.delete(ti); continue; }
      const tx = ti % WORLD_W, ty = (ti / WORLD_W) | 0;
      const [px, py] = this.toScreen(tx, ty);
      if (px < -tz || py < -tz || px > this.w || py > this.h) continue;
      ctx.fillStyle = `rgba(122,82,44,${(0.75 - 0.4 * (tick - t) / 4000).toFixed(2)})`;
      ctx.fillRect(px, py, tz + 0.5, tz + 0.5);
      if (tz >= 5) {
        ctx.strokeStyle = 'rgba(70,45,20,0.6)'; ctx.lineWidth = 1;
        ctx.beginPath();
        for (const k of [0.3, 0.7]) { ctx.moveTo(px + 1, py + tz * k); ctx.lineTo(px + tz - 1, py + tz * k); }
        ctx.stroke();
      }
    }

    // ruins: rubble that fades over 8000 ticks
    for (const [ti, t] of Shelters.ruins) {
      const [px, py] = this.toScreen(ti % WORLD_W, (ti / WORLD_W) | 0);
      if (px < -z || py < -z || px > this.w || py > this.h) continue;
      ctx.fillStyle = `rgba(120,115,108,${(0.8 * (1 - (tick - t) / 8000)).toFixed(2)})`;
      for (const [fx, fy] of [[0.2, 0.25], [0.6, 0.2], [0.35, 0.6], [0.7, 0.65]]) ctx.fillRect(px + z * fx, py + z * fy, Math.max(1, z * 0.18), Math.max(1, z * 0.14));
    }

    // event overlays (fire fronts, radiation zones...): above the land layers, below night shading, food and simlets
    Events.draw(ctx, this);

    // night shading: light, and applied to the land only, so food and simlets stay at full brightness
    const dk = World.darkness(tick);
    if (dk > 0 && !editMode) { ctx.fillStyle = `rgba(20,30,70,${(0.25 * dk).toFixed(3)})`; ctx.fillRect(0, 0, this.w, this.h); }

    // visible world rectangle
    const [wx0, wy0] = this.toWorld(0, 0), [wx1, wy1] = this.toWorld(this.w, this.h);
    const vis = (x, y, m) => x > wx0 - m && x < wx1 + m && y > wy0 - m && y < wy1 + m;

    // food
    const fr = Math.max(1, 0.2 * z);
    Food.forEach(f => {
      if (!vis(f.x, f.y, 1)) return;
      const [sx, sy] = this.toScreen(f.x, f.y);
      if (f.type === 2) {
        ctx.globalAlpha = clamp(f.e / f.e0, 0.15, 1);
        ctx.fillStyle = '#9a9a9a';
        ctx.beginPath(); ctx.arc(sx, sy, fr * 1.6, 0, 7); ctx.fill();
        ctx.globalAlpha = 1;
      } else if (f.ready > tick) {                           // growing crop: small sprout
        ctx.fillStyle = '#b5d65a'; ctx.strokeStyle = 'rgba(40,30,0,0.7)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(sx, sy, fr * 0.9, 0, 7); ctx.fill(); ctx.stroke();
      } else if (f.type === 1) {                              // ripe crop: bigger amber grain with outline
        ctx.fillStyle = '#f2a51a'; ctx.strokeStyle = 'rgba(70,35,0,0.85)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(sx, sy, fr * 1.5, 0, 7); ctx.fill(); ctx.stroke();
      } else {
        ctx.fillStyle = '#9be36b';
        ctx.fillRect(sx - fr, sy - fr, fr * 2, fr * 2);
      }
    });

    // shelters: foundations show build progress; finished huts darken with size, with store bar and occupant pips
    for (const sh of Shelters.tiles.values()) {
      const [px, py] = this.toScreen(sh.ti % WORLD_W, (sh.ti / WORLD_W) | 0);
      if (px < -z || py < -z || px > this.w || py > this.h) continue;
      const m = z * 0.08, w = z - 2 * m;
      if (!sh.done) {
        ctx.strokeStyle = 'rgba(110,75,40,0.9)'; ctx.lineWidth = 1; ctx.setLineDash([2, 2]);
        ctx.strokeRect(px + m, py + m, w, w); ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(150,105,60,0.55)'; ctx.fillRect(px + m, py + m + w * (1 - sh.progress), w, w * sh.progress);
        continue;
      }
      ctx.globalAlpha = 0.5 + 0.5 * sh.health;
      // house: pale walls, terracotta roof, dark outline (distinct from brown farmland)
      ctx.fillStyle = '#e9dcc3'; ctx.strokeStyle = '#2a1a10'; ctx.lineWidth = 1;
      ctx.fillRect(px + m, py + z * 0.45, w, z * 0.55 - m); ctx.strokeRect(px + m, py + z * 0.45, w, z * 0.55 - m);
      ctx.fillStyle = '#c0533a';
      ctx.beginPath(); ctx.moveTo(px + m * 0.5, py + z * 0.5); ctx.lineTo(px + z / 2, py + m); ctx.lineTo(px + z - m * 0.5, py + z * 0.5); ctx.closePath();
      ctx.fill(); ctx.stroke();
      if (sh.store > 0) { ctx.fillStyle = '#f2a51a'; ctx.fillRect(px + m, py + z - m - Math.max(1.5, z * 0.12), w * sh.store / STORE_CAP, Math.max(1.5, z * 0.12)); }
      for (let k = 0; k < sh.occ; k++) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(px + z * (0.35 + 0.3 * k), py + z * 0.62, Math.max(1, z * 0.07), 0, 7); ctx.fill(); }
      ctx.globalAlpha = 1;
    }

    // selected simlet's vision cone (under everything else)
    if (selected && !selected.dead) {
      const s = selected, [sx, sy] = this.toScreen(s.x, s.y), R = s.range * z;
      ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(sx, sy);
      ctx.arc(sx, sy, R, s.heading - s.fovAngle / 2, s.heading + s.fovAngle / 2); ctx.closePath();
      ctx.fill(); ctx.stroke();
    }

    // simlets
    for (const s of Sim.simlets) {
      if (!vis(s.x, s.y, 3)) continue;
      if (s.inShelter && s !== selected) continue;      // indoors: shown as a pip on the shelter instead
      const [sx, sy] = this.toScreen(s.x, s.y);
      const r = Math.max(3, s.radius * z), h = s.heading;
      const d = s.g[G.diet], cls = d < 0.33 ? 0 : d > 0.66 ? 2 : 1;
      const col = this.colorBy === 'diet' ? DIET_COLORS[cls] : this.colorBy === 'species' ? Species.color(s.species) : s.color;
      let alpha = 1 - 0.65 * s.camoEff;
      if (s.action === 'rest') alpha *= 0.55;
      const role = this.highlight ? this.highlight.roles.get(s) : null;
      if (this.highlight && !role && s !== this.highlight.self) alpha *= 0.18;   // fade everyone not highlighted
      if (s.sprinting && s.curSpeed > 0) {                 // motion trail
        ctx.strokeStyle = col; ctx.globalAlpha = 0.35 * alpha; ctx.lineWidth = r * 0.8;
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx - Math.cos(h) * r * 3.5, sy - Math.sin(h) * r * 3.5); ctx.stroke();
      }
      ctx.globalAlpha = alpha;
      // body shape by diet class, drawn in local coordinates (x = heading), stretched by the speed gene:
      // herbivore = round teardrop, omnivore = diamond, carnivore = sharp notched arrowhead
      const lk = s.look;
      const pt = (ang, k) => ctx.lineTo(Math.cos(ang) * r * k, Math.sin(ang) * r * k);
      const body = () => {
        ctx.beginPath();
        if (cls === 0) {
          const tip = 1.5, a = Math.acos(1 / tip);
          ctx.moveTo(r * tip, 0); ctx.arc(0, 0, r, a, 2 * Math.PI - a);
        } else if (cls === 1) {
          pt(0, 1.7); pt(Math.PI / 2, 1.05); pt(Math.PI, 1.0); pt(-Math.PI / 2, 1.05);
        } else {
          pt(0, 2.1); pt(2.45, 1.4); pt(Math.PI, 0.45); pt(-2.45, 1.4);
        }
        ctx.closePath();
      };
      ctx.save(); ctx.translate(sx, sy); ctx.rotate(h); ctx.scale(lk.len, lk.wid);
      body(); ctx.fillStyle = col; ctx.fill();
      if (r >= 4.5 && lk.pattern !== 'plain') {             // markings, only when zoomed in enough to read them
        ctx.save(); ctx.clip(); ctx.fillStyle = lk.mark; ctx.beginPath();
        if (lk.pattern === 'spots') for (const [px, py] of [[-0.35, -0.45], [0.35, 0.3], [-0.6, 0.35]]) { ctx.moveTo(px * r + 0.24 * r, py * r); ctx.arc(px * r, py * r, 0.24 * r, 0, 7); }
        else if (lk.pattern === 'stripes') for (const px of [-0.55, 0.05, 0.65]) ctx.rect(px * r, -2 * r, 0.22 * r, 4 * r);
        else if (lk.pattern === 'mask') ctx.rect(0.55 * r, -2 * r, 2 * r, 4 * r);
        else ctx.rect(-2 * r, -0.16 * r, 4.5 * r, 0.32 * r);   // spine: a stripe down the back
        ctx.fill(); ctx.restore();
      }
      body(); ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = lk.edge; ctx.stroke();
      ctx.restore();
      ctx.globalAlpha = 1;
      if (role) {                                           // relative / species-mate ring
        ctx.strokeStyle = HIGHLIGHT_COLORS[role]; ctx.lineWidth = role === 'species' ? 1.5 : 2.5;
        ctx.beginPath(); ctx.arc(sx, sy, r + 4, 0, 7); ctx.stroke();
      }
      if (s.alarmFlash > 0) {
        ctx.strokeStyle = `rgba(255,255,255,${(s.alarmFlash / 30).toFixed(2)})`; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(sx, sy, r * (1.5 + (30 - s.alarmFlash) / 4), 0, 7); ctx.stroke();
      }
    }

    // selected: highlight ring + line to its target
    if (selected && !selected.dead) {
      const s = selected, [sx, sy] = this.toScreen(s.x, s.y);
      if (s.target && !s.target.dead && !s.target.removed) {
        const [tx, ty] = this.toScreen(s.target.x, s.target.y);
        ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(tx, ty); ctx.stroke(); ctx.setLineDash([]);
      }
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(sx, sy, Math.max(2, s.radius * z) + 5, 0, 7); ctx.stroke();
    }

    // landing rings where a tribe was air-dropped or immigrated (fade over 1.5 s)
    const now = performance.now();
    Sim.dropFx = Sim.dropFx.filter(f => now - f.t < 1500);
    for (const f of Sim.dropFx) {
      const k = (now - f.t) / 1500, [fx, fy] = this.toScreen(f.x, f.y);
      ctx.strokeStyle = `rgba(230,162,60,${(1 - k).toFixed(2)})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(fx, fy, (3 + k * 10) * z, 0, 7); ctx.stroke();
    }

  },

  pick(px, py) {
    const [x, y] = this.toWorld(px, py);
    let best = null, bd = 1e9;
    for (const s of Sim.simlets) {
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < s.radius + 8 / this.cam.zoom && d < bd) { bd = d; best = s; }
    }
    return best;
  },
};
