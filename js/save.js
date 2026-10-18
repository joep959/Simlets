'use strict';
// Save / load the whole world (map, soil, scent, food, simlets with genes + brains, species, history, settings)
// as one JSON file, so long experiments survive a page reload and can be branched.

const SAVE_VERSION = 4;                                     // 4: living land (tree cover); 3 still loads
// Optional fields added since v4 (older v4 files simply lack them): systems (per-system state, see registerSystem),
// world.flood, simlet fx. Terrain is one base-36 character per tile (World.encodeTerrain).
const r4 = v => Math.round(v * 1e4) / 1e4;                  // trim floats so the file stays a sensible size
const packF = arr => Array.from(arr, r4);

const Save = {
  serialize() {
    const simlets = Sim.simlets.map(s => ({
      id: s.id, g: packF(s.g), brain: s.brain ? packF(s.brain) : null,
      x: r4(s.x), y: r4(s.y), heading: r4(s.heading), gen: s.gen, parents: s.parents, origin: s.origin,
      age: s.age, energy: r4(s.energy), stam: r4(s.stam), exhausted: s.exhausted,
      children: s.children, kills: s.kills, farmed: s.farmed, donated: s.donated,
      attackCd: s.attackCd, breedCd: s.breedCd, alarmCd: s.alarmCd, breedMode: s.breedMode, readySince: s.readySince,
      memory: s.memory, field: s.field, species: s.species ? s.species.id : null, inShelter: s.inShelter ? s.inShelter.ti : null, built: s.built || 0, home: s.home, project: s.project,
      fx: Object.keys(s.fx).length ? s.fx : undefined,
    }));
    const systems = {};                                     // every registered system that keeps its own state
    for (const sys of Systems) if (sys.save) systems[sys.name] = sys.save();
    const foods = [];
    Food.forEach(f => foods.push([r4(f.x), r4(f.y), r4(f.e), r4(f.e0 || 0), f.born, f.ready, f.type, f.rot || 0]));
    return {
      version: SAVE_VERSION, savedAt: new Date().toISOString(),
      params: { ...P }, brainMode: Brain.mode, nextId: NEXT_ID,
      world: {
        terrain: World.encodeTerrain(), soil: packF(World.soil), trees: packF(World.trees), scent: packF(World.scent),
        iceNoise: packF(World.iceNoise), tilled: [...World.tilled], flood: World.floodTiles.size ? [...World.floodTiles] : undefined,
      },
      sim: {
        tick: Sim.tick, births: Sim.births, deaths: Sim.deaths, alarms: Sim.alarms, farmEvents: Sim.farmEvents,
        stillborn: Sim.stillborn, arrivals: Sim.arrivals, lastImmigration: Sim.lastImmigration,
        birthsSex: Sim.birthsSex, birthsAsex: Sim.birthsAsex, brainInfluence: Sim.brainInfluence,
        history: { ...Sim.history, mean: Sim.history.mean.map(packF), sd: Sim.history.sd.map(packF) },
      },
      species: {
        nextId: Species.nextId, slots: Species.slots, extinctCount: Species.extinctCount,
        live: [...Species.live.values()].map(sp => ({ id: sp.id, rep: packF(sp.rep), parent: sp.parent, born: sp.born,
                                                      count: sp.count, peak: sp.peak, slot: sp.slot, dietMean: sp.dietMean })),
        meta: [...Species.meta.values()].filter(sp => !Species.live.has(sp.id)).map(sp => ({ id: sp.id, slot: sp.slot, parent: sp.parent, born: sp.born })),
      },
      shelters: { started: Shelters.started, finished: Shelters.finished, crumbled: Shelters.crumbled, collapsed: Shelters.collapsed,
        ruins: [...Shelters.ruins],
        tiles: [...Shelters.tiles.values()].map(sh => ({ ti: sh.ti, owner: packF(sh.owner), progress: sh.progress, done: sh.done,
                 health: r4(sh.health), store: r4(sh.store), lastWork: sh.lastWork, lastUsed: sh.lastUsed })) },
      food: foods, simlets, systems,
    };
  },

  restore(o) {
    if (!o || (o.version !== SAVE_VERSION && o.version !== 3)) throw new Error('Not a Simlets world file (or a newer version)');
    // settings first (derived body stats depend on them)
    Object.assign(P, o.params); Brain.mode = o.brainMode || 'hybrid';
    // map with its living layers; a version 3 file (painted types, no trees) is converted like an old map file
    const v4 = o.version >= 4;
    World.fromJSON(JSON.stringify(v4 ? { w: WORLD_W, h: WORLD_H, v: 2, data: o.world.terrain, trees: o.world.trees, soil: o.world.soil }
                                     : { w: WORLD_W, h: WORLD_H, data: o.world.terrain }));
    if (o.world.iceNoise) World.iceNoise = Float32Array.from(o.world.iceNoise);
    Sim.reset();                                            // clears simlets, food, species, history, tilled, scent
    if (!v4) for (let i = 0; i < World.soil.length; i++) World.setSoil(i, Math.min(World.soil[i], o.world.soil[i]));
    World.scent.set(o.world.scent);
    World.refreshLand();
    World.tilled = new Map(o.world.tilled);
    if (o.world.flood) for (const i of o.world.flood) World.setFlood(i, true);
    Object.assign(Sim, { tick: o.sim.tick, births: o.sim.births, deaths: o.sim.deaths, alarms: o.sim.alarms,
      farmEvents: o.sim.farmEvents, stillborn: o.sim.stillborn, arrivals: o.sim.arrivals, lastImmigration: o.sim.lastImmigration,
      birthsSex: o.sim.birthsSex, birthsAsex: o.sim.birthsAsex, brainInfluence: o.sim.brainInfluence, history: o.sim.history });
    if (!Sim.history.land) Sim.history.land = Sim.history.t.map(() => null);   // saved before the Land chart: no data
    World.updateIce(Sim.tick);
    // species
    Species.nextId = o.species.nextId; Species.slots = o.species.slots; Species.extinctCount = o.species.extinctCount;
    for (const m of o.species.meta) Species.meta.set(m.id, { ...m, count: 0 });
    for (const sp of o.species.live) {
      const x = { ...sp, rep: Float32Array.from(sp.rep), pick: null };
      Species.live.set(x.id, x); Species.meta.set(x.id, x);
    }
    // shelters
    Object.assign(Shelters, { started: o.shelters.started, finished: o.shelters.finished, crumbled: o.shelters.crumbled, collapsed: o.shelters.collapsed });
    Shelters.ruins = new Map(o.shelters.ruins);
    for (const t of o.shelters.tiles) Shelters.tiles.set(t.ti, { ...t, owner: Float32Array.from(t.owner), x: t.ti % WORLD_W + 0.5, y: ((t.ti / WORLD_W) | 0) + 0.5, occ: 0 });
    // food
    for (const [x, y, e, e0, born, ready, type, rot] of o.food) Food.add({ x, y, e, e0, born, ready, type, rot: rot || 0 });
    // simlets: rebuild through the constructor (re-derives body stats), then restore their state
    for (const d of o.simlets) {
      const s = new Simlet(Float32Array.from(d.g), d.x, d.y, d.energy, d.gen, d.parents);
      Object.assign(s, {
        id: d.id, heading: d.heading, desired: d.heading, origin: d.origin, age: d.age, energy: d.energy,
        stam: d.stam, exhausted: d.exhausted, children: d.children, kills: d.kills, farmed: d.farmed, donated: d.donated,
        attackCd: d.attackCd, breedCd: d.breedCd, alarmCd: d.alarmCd, breedMode: d.breedMode, readySince: d.readySince,
        memory: d.memory || [], field: d.field, brain: d.brain ? Float32Array.from(d.brain) : newBrain(),
        species: Species.live.get(d.species) || null, needThink: true, built: d.built || 0, home: d.home ?? null, project: d.project ?? null,
        inShelter: d.inShelter != null ? Shelters.tiles.get(d.inShelter) || null : null, fx: d.fx || {},
      });
      if (!s.species) Species.assign(s, Sim.tick);
      Sim.simlets.push(s);
    }
    NEXT_ID = o.nextId;
    for (const sys of Systems) if (sys.load && o.systems && o.systems[sys.name] !== undefined) sys.load(o.systems[sys.name]);
    World.dirty = true;
  },
};
