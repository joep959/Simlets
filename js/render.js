'use strict';
// Draws terrain, food and simlets onto the map canvas. Camera = pan + zoom (pixels per tile).

const TILE_PX = 6;
const DIET_COLORS = ['#199e70', '#3987e5', '#d95926'];   // herbivore, omnivore, carnivore (same as charts)   // resolution of the cached terrain image
const Render = {
  canvas: null, ctx: null, terrainCanvas: null,
  cam: { x: WORLD_W / 2, y: WORLD_H / 2, zoom: 5 },   // centre of view (tiles) and pixels per tile
  dpr: 1, w: 0, h: 0,
  colorBy: 'species',   // 'diet' = herbivore/omnivore/carnivore, 'lineage' = colour from genome, 'species' = cluster colour

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

  rebuildTerrain() {
    const c = this.terrainCanvas.getContext('2d');
    for (let y = 0; y < WORLD_H; y++) for (let x = 0; x < WORLD_W; x++) {
      const t = World.terrain[y * WORLD_W + x];
      c.fillStyle = TERRAIN_INFO[t].color;
      c.fillRect(x * TILE_PX, y * TILE_PX, TILE_PX, TILE_PX);
      // subtle texture so terrain doesn't look like flat paint
      const h = ((x * 73856093) ^ (y * 19349663)) >>> 0;
      if (t === TERRAIN.FOREST) {
        c.fillStyle = 'rgba(20,45,25,0.45)';
        c.beginPath(); c.arc(x * TILE_PX + (h % 4) + 1, y * TILE_PX + ((h >> 3) % 4) + 1, 1.6, 0, 7); c.fill();
      } else if (t === TERRAIN.WATER) {
        if (h % 5 === 0) { c.fillStyle = 'rgba(255,255,255,0.06)'; c.fillRect(x * TILE_PX + 1, y * TILE_PX + 2, 3, 1); }
      } else if (h % 3 === 0) {
        c.fillStyle = 'rgba(0,0,0,0.05)'; c.fillRect(x * TILE_PX + (h % 5), y * TILE_PX + ((h >> 4) % 5), 1, 1);
      }
    }
    World.dirty = false;
  },

  draw(selected, editMode) {
    if (World.dirty) this.rebuildTerrain();
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
      const [sx, sy] = this.toScreen(s.x, s.y);
      const r = Math.max(3, s.radius * z), h = s.heading;
      const d = s.g[G.diet], cls = d < 0.33 ? 0 : d > 0.66 ? 2 : 1;
      const col = this.colorBy === 'diet' ? DIET_COLORS[cls] : this.colorBy === 'species' ? Species.color(s.species) : s.color;
      let alpha = 1 - 0.65 * s.camoEff;
      if (s.action === 'rest') alpha *= 0.55;
      if (s.sprinting && s.curSpeed > 0) {                 // motion trail
        ctx.strokeStyle = col; ctx.globalAlpha = 0.35 * alpha; ctx.lineWidth = r * 0.8;
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx - Math.cos(h) * r * 3.5, sy - Math.sin(h) * r * 3.5); ctx.stroke();
      }
      ctx.globalAlpha = alpha;
      // body shape by diet class, pointing along heading:
      // herbivore = round teardrop, omnivore = diamond, carnivore = sharp notched arrowhead
      const pt = (ang, k) => [sx + Math.cos(h + ang) * r * k, sy + Math.sin(h + ang) * r * k];
      ctx.fillStyle = col; ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 1;
      ctx.beginPath();
      if (cls === 0) {
        const tip = 1.5, a = Math.acos(1 / tip);
        ctx.moveTo(...pt(0, tip));
        ctx.arc(sx, sy, r, h + a, h - a + 2 * Math.PI);
      } else if (cls === 1) {
        ctx.moveTo(...pt(0, 1.7)); ctx.lineTo(...pt(Math.PI / 2, 1.05));
        ctx.lineTo(...pt(Math.PI, 1.0)); ctx.lineTo(...pt(-Math.PI / 2, 1.05));
      } else {
        ctx.moveTo(...pt(0, 2.1)); ctx.lineTo(...pt(2.45, 1.4));
        ctx.lineTo(...pt(Math.PI, 0.45)); ctx.lineTo(...pt(-2.45, 1.4));
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.globalAlpha = 1;
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
