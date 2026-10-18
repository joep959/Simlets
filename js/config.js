'use strict';
// Fixed world constants and the tunable parameters shown as sliders in the UI.

const WORLD_W = 200, WORLD_H = 125;   // map size in tiles; all positions are in tile units

const TERRAIN = { GRASS: 0, FERTILE: 1, FOREST: 2, WATER: 3 };
// Tile property table: everything that behaves differently per terrain type reads these properties instead of
// comparing to TERRAIN.FOREST etc. (water and ice keep their own special handling). A new type = a new row.
//   color       map colour (render.js);  chart: line colour on the dark Land chart (null = not charted)
//   spawnKey    P key of the wild-food spawn rate (‰ per tile per tick), or null = no wild food
//   spawnOrder  order of the spawn calls in Sim.step (fixed, so the random-number sequence never changes)
//   bustHit     true = the Bust food multiplier applies to its wild food; false = steady all year
//   farmKey     P key of the farm-yield multiplier, or null = not farmable
//   vision      vision range multiplier while standing inside it
//   camo        camouflage bonus while standing inside it (added, capped at 1)
//   coldKey     P key of the share of winter cold escaped while inside it, or null = no cold shelter
//   buildable   shelters can be built on it;  timber: building in or next to it is cheaper (costFactor)
//   forest      counts as established forest: brain 'inForest' input, seeds tree growth, not browsed
const TERRAIN_INFO = [
  { name: 'Grassland', color: '#d6cf98', chart: '#d6cf98', spawnKey: 'grassSpawn',   spawnOrder: 1, bustHit: true,  farmKey: 'farmYieldGrass',
    vision: 1,   camo: 0,   coldKey: null,            buildable: true,  timber: false, forest: false },
  { name: 'Fertile',   color: '#6aa84f', chart: '#8fd16a', spawnKey: 'fertileSpawn', spawnOrder: 0, bustHit: true,  farmKey: 'farmYieldFertile',
    vision: 1,   camo: 0,   coldKey: null,            buildable: true,  timber: false, forest: false },
  { name: 'Forest',    color: '#3d6b45', chart: '#3fae7a', spawnKey: 'forestSpawn',  spawnOrder: 2, bustHit: false, farmKey: null,
    vision: 0.6, camo: 0.3, coldKey: 'forestShelter', buildable: true,  timber: true,  forest: true },
  { name: 'Water',     color: '#4a86c0', chart: null,      spawnKey: null,           spawnOrder: 9, bustHit: false, farmKey: null,
    vision: 1,   camo: 0,   coldKey: null,            buildable: false, timber: false, forest: false },
];
// terrain types with wild food, in spawn order (fertile, grassland, forest)
const SPAWN_TYPES = TERRAIN_INFO.map((t, i) => i).filter(i => TERRAIN_INFO[i].spawnKey)
  .sort((a, b) => TERRAIN_INFO[a].spawnOrder - TERRAIN_INFO[b].spawnOrder);

// Fixed behaviour constants (not worth a slider yet)
const THINK_INTERVAL = 5;     // ticks between decisions
const MATURE_AGE = 600;       // ticks before a simlet can breed
const BREED_COOLDOWN = 400;
const MATE_WAIT = 300;        // ticks a sexual breeder searches for a mate before falling back to asexual
const ATTACK_COOLDOWN = 30;
const FARM_GROW_TIME = 300;   // ticks before farmed food is edible
const CORPSE_ROT = 1500;      // ticks for a corpse to fully decay
const MEAT_BITE = 2;          // energy per tick taken from a corpse (meat is quick to eat)
const SOIL_MIN = 0.3;          // soil nutrients below this = dormant: no farming, no wild growth
const SOIL_PER_ENERGY = 0.02;  // nutrients returned to the soil per unit of energy that rots there
const VISION_AREA = 200;      // tiles² every simlet can see; the FOV gene only reshapes it (wide+short vs narrow+long)

// Living land (world.js): only land vs water is painted. Fertile / grassland / forest are worked out from each
// tile's moisture, soil and tree cover, with a gap between the on and off levels so boundary tiles don't flicker.
const MOIST_BASE = 0.3;                      // moisture of land far from any water (rain alone)
const MOIST_RANGE = 10;                      // tiles: how far water's moisture reaches inland (exponential fall-off)
const FERTILE_ON = 0.75, FERTILE_OFF = 0.6;  // soil level at which land turns fertile / stops being fertile
const FOREST_ON = 0.6, FOREST_OFF = 0.4;     // tree cover at which land turns to forest / stops being forest
const TREE_RATE = 0.0007;                    // tree growth per tick at full speed (scaled by the Forest growth slider)
const TREE_SEED = 0.15;                      // how strongly neighbouring trees seed a tile, relative to its own trees
const BROWSE = 0.15;                         // tree cover eaten off young (non-forest) trees per wild plant eaten there
const BRUSHES = [
  { key: 'water',  name: 'Water',        color: '#4a86c0', tip: 'Water. Land near water is moist: its soil can get rich enough to be fertile, and trees grow there. Crossable but costly to swim.' },
  { key: 'land',   name: 'Land',         color: '#d6cf98', tip: 'Bare land: clears trees and resets the soil to what its moisture supports. Near water it becomes fertile by itself.' },
  { key: 'forest', name: 'Plant forest', color: '#3d6b45', tip: 'Godly power: plant mature trees. Forest spreads on its own onto moist land nearby, unless grazers browse the saplings or farmers clear them.' },
  { key: 'enrich', name: 'Enrich soil',  color: '#6aa84f', tip: 'Godly power: fill the soil with nutrients, making fertile land. Far from water the extra slowly leaches away; grazing and farming use it up.' },
];

// [section, key, label, min, max, step, default]
const PARAM_DEFS = [
  ['Evolution',  'mutationRate',     'Mutation rate (per gene)',        0,    0.5,  0.01,  0.06],
  ['Evolution',  'mutationSize',     'Mutation size (σ)',               0,    0.3,  0.01,  0.08],
  ['Evolution',  'speciesThreshold', 'Species similarity threshold',    0.4,  0.95, 0.01,  0.7],
  ['Evolution',  'brainMutSize',     'Brain mutation size (hybrid)',    0,    1,    0.01,  0.2],
  ['Evolution',  'speciesMinShown',  'Smallest species listed',          1,    20,   1,     5],
  ['Food',       'fertileSpawn',     'Fertile spawn ‰ /tile/tick',      0,    5,    0.05,  1.5],
  ['Food',       'grassSpawn',       'Grassland spawn ‰ /tile/tick',    0,    1,    0.01,  0.2],
  ['Food',       'bustFactor',       'Bust food multiplier',            0,    1,    0.01,  0.25],
  ['Food',       'plantEnergy',      'Plant food energy',               1,    30,   1,     10],
  ['Food',       'rotTime',          'Plant rot time (ticks)',          200,  6000, 100,   2000],
  ['Food',       'plantBite',        'Plant eating speed (energy/tick)', 0.1,  3,    0.1,   0.5],
  ['Food',       'boomRot',          'Boom rot speed ×',                1,    5,    0.25,  2],
  ['Food',       'cropKeep',         'Crop storage (rot time ×)',       1,    10,   0.5,   4],
  ['Food',       'soilRecovery',     'Soil recovery time (ticks)',      500,  20000, 250,  4000],
  ['Food',       'forestSpawn',      'Forest spawn ‰ /tile/tick',       0,    1,    0.01,  0.1],
  ['Food',       'tileCap',          'Max wild food per tile',          1,    6,    1,     2],
  ['Food',       'scentFade',        'Scent half-life (ticks)',         50,   3000, 50,    600],
  ['Land',       'treeGrowth',       'Forest growth speed ×',           0,    3,    0.1,   1],
  ['Land',       'plantSoil',        'Soil used per wild plant',        0,    1,    0.05,  0.1],
  ['Time',       'seasonLength',     'Season length (ticks)',           500,  10000,100,   3000],
  ['Time',       'bustShare',        'Bust share of the year',          0.2,  0.8,  0.05,  0.67],
  ['Time',       'dayLength',        'Day length (ticks)',              200,  4000, 50,    1000],
  ['Shelters',   'buildCost',        'Shelter build cost (energy/tile)', 10,   200,  5,     40],
  ['Shelters',   'shelterLife',      'Shelter lifespan unused (ticks)', 2000, 60000, 1000, 20000],
  ['Winter',     'iceReach',         'Ice reach (tiles from shore)',    0,    10,   0.5,   3],
  ['Winter',     'winterCold',       'Winter cold (extra idle drain)',  0,    1,    0.05,  0.5],
  ['Winter',     'forestShelter',    'Forest shelter from cold',        0,    1,    0.05,  0.7],
  ['Costs',      'idleCost',         'Idle drain',                      0,    0.1,  0.002, 0.015],
  ['Costs',      'moveCost',         'Movement cost',                   0,    0.2,  0.005, 0.02],
  ['Costs',      'sprintMult',       'Sprint speed ×',                  1,    3,    0.1,   1.8],
  ['Costs',      'waterCost',        'Water movement cost ×',           1,    15,   0.5,   6],
  ['Costs',      'attackCost',       'Attack cost',                     0,    10,   0.5,   2],
  ['Costs',      'bodyCost',         'Body energy (per unit mass)',     1,    20,   0.5,   5],
  ['Costs',      'breedCost',        'Breeding overhead',               0,    30,   1,     6],
  ['Costs',      'farmCost',         'Farming cost',                    1,    40,   1,     8],
  ['Costs',      'farmYieldFertile', 'Farm yield on fertile ×',         0,    4,    0.1,   2.0],
  ['Costs',      'farmYieldGrass',   'Farm yield on grassland ×',       0,    4,    0.1,   1.4],
  ['Immigration', 'immigration',     'New tribe every N ticks (0 = off)', 0,   20000, 500,  3000],
  ['Population', 'tribes',           'Starting tribes',                 1,    20,   1,     8],
  ['Population', 'tribeSize',        'Simlets per tribe',               2,    60,   1,     20],
  ['Population', 'seedSpread',       'Starting spread (share of map)',  0.1,  1,    0.05,  1],
  ['Population', 'founderEnergy',    'Founder starting energy',         0.2,  1,    0.05,  0.7],
  ['Population', 'leanPredators',    'Lean predator founders',          0,    1,    0.05,  0],
  ['Population', 'maxPop',           'Population cap',                  100,  3000, 50,    1500],
  ['Display',    'chartWindow',      'Chart history (ticks, 0 = all)',  0,    100000, 1000, 30000],
];

// Hover explanations for the sliders
const PARAM_TIPS = {
  mutationRate: 'Chance that each gene mutates when a child is made. Higher = faster evolution, but more badly broken offspring.',
  mutationSize: 'How big a mutation is: the spread of the random nudge, on the 0 to 1 gene scale.',
  speciesThreshold: 'Two simlets count as the same species if their genomes are at least this similar (to the species representative). Lower = fewer, broader species; higher = more, finer species. Display only: it does not change who can mate.',
  brainMutSize: 'How far a brain weight moves when it mutates (Hybrid brain mode only). Uses the same per-weight chance as the Mutation rate slider. Bigger = faster but more erratic learning.',
  speciesMinShown: 'Display only: species with fewer members than this are lumped together as "Other" in the species list, the species count and the chart/map colours. Keeps short-lived splinter groups from cluttering the view.',
  fertileSpawn: 'Chance per fertile tile per tick (in thousandths) that a wild plant appears, in boom season.',
  grassSpawn: 'Same as above, for grassland. Set to 0 and grassland only produces food by farming.',
  bustFactor: 'Food growth during bust as a fraction of boom. 0.25 = bust grows a quarter as much.',
  plantEnergy: 'Energy in one wild plant. Farmed crops are split into items of roughly this size.',
  rotTime: 'Ticks before an uneaten plant rots away. Stops boom-season food piling up to carry everyone through the bust.',
  plantBite: 'Handling time for plants: energy taken per tick while eating one. Low = plants are slow, poor-quality food, so herbivores spend long spells standing still eating. Meat is always eaten at 2 per tick.',
  boomRot: 'How much faster wild plants and field crops rot during boom (warm weather) than in bust. Food stored in shelters never rots, so a faster boom rot makes granaries the only way to bank boom-season surplus for winter.',
  cropKeep: 'Farmed crops last this many times longer than wild plants before rotting, like a granary. Lets a boom-season harvest carry a family through the bust.',
  soilRecovery: 'Ticks for exhausted soil to recover fully next to water (dry land is a little slower). Soil recovers only up to what its moisture supports: rich near water, poor far from it. Farming and grazing use nutrients up; until a tile recovers past 30% it is dormant: no crops, no wild food. Rotting corpses and food put nutrients back, even above the normal level (that extra slowly leaches away).',
  forestSpawn: 'Chance per forest tile per tick (in thousandths) that a wild plant appears. Unlike fertile land and grassland, forest food is NOT reduced in bust: low but steady all year.',
  treeGrowth: 'How fast trees grow and spread onto neighbouring moist land. At 1, a forest edge creeps forward about one tile a year when nothing stops it. Grazers eating wild plants browse young trees back; farming and building clear them. 0 = forests never grow or spread.',
  plantSoil: 'Nutrients a wild plant takes from its tile\'s soil as it grows. They go back into the soil if the plant rots, but leave with the eater if it is eaten. So heavily grazed land wears out and stops being fertile, the herd moves on, and the land recovers behind it. 0 = grazing never wears land out.',
  scentFade: 'Plant-eaters leave a scent trail on the tiles they walk; this is how long it takes to fade to half strength. Longer = older trails stay followable, so predators find herds from further away.',
  buildCost: 'Total energy to build one shelter tile, paid over 4 work sessions. 40% cheaper in or next to forest (timber) and 40% cheaper next to an existing shelter (shared walls); both discounts stack. Several relatives can share the work.',
  shelterLife: 'How long a finished shelter lasts with nobody inside (10x longer while occupied). Working on it repairs it. When it falls down it leaves fertile ruins.',
  iceReach: 'How far ice grows out from the shore at the depth of a bust (in tiles). Narrow rivers freeze right across and become bridges; wide lakes only freeze at the edges. Ice thaws as the bust ends. 0 = water never freezes.',
  winterCold: 'Extra idle energy drain during bust, as a fraction (0.5 = +50%). Makes winter itself harsh, not just food-poor.',
  forestShelter: 'How much of the winter cold a simlet escapes while in forest (0.7 = 70% less cold).',
  tileCap: 'Maximum wild plants on one tile. Farmed crops may stack 2 higher.',
  seasonLength: 'Half the length of a year in ticks. A full boom + bust year is twice this, split by the Bust share slider.',
  bustShare: 'Fraction of each year that is bust (a year = 2 × season length). 0.5 = equal boom and bust; 0.67 = short boom, long hard winter, where storing food pays off.',
  dayLength: 'Ticks per day-night cycle. Night cuts vision range by 40% and makes resting more attractive.',
  idleCost: 'Energy drained every tick just to stay alive. Scaled by mass, and raised by the lifespan and memory genes.',
  moveCost: 'Energy per tick for moving = this × mass × (speed / 0.1)². Water multiplies it.',
  sprintMult: 'Sprint speed as a multiple of top speed. Cost rises with the square: 1.8× speed costs about 3.2×.',
  waterCost: 'Movement cost multiplier while in water. Speed is also halved in water.',
  attackCost: 'Energy an attacker spends per attack (bigger attackers pay more). A target that survives loses half this.',
  bodyCost: 'Energy stored in a body per unit of mass. Building a child costs this much, and 90% of it comes back as meat when the body dies. Higher = babies are dearer for everyone, but corpses and prey are richer meals.',
  breedCost: 'Overhead of breeding, lost on top of the energy given to the children. The initiator pays it in full, the mate pays half.',
  farmCost: 'Energy a simlet spends each time it farms.',
  farmYieldFertile: 'Crop energy produced per unit of farming energy on fertile land. Above 1 = farming is a net gain, if the farmer gets to eat the crop. Bonuses: +12.5% per neighbouring active field (max +50%), +25% with a finished house within 2 tiles.',
  farmYieldGrass: 'Same as above, on grassland.',
  immigration: 'Trickle of newcomers: every N ticks a brand-new random tribe lands somewhere on dry land. 0 = off. Newcomers have random genes (genetically foreign, so they cannot interbreed with the locals at first) but borrow the brain of a living simlet with a similar diet.',
  tribes: 'Number of founder groups dropped in when you Run a fresh map or Restart. Each tribe gets its own random genome.',
  tribeSize: 'Simlets per founder group, all close relatives of their founder. Also used for air-drops and immigrants.',
  seedSpread: 'How much of the map the starting tribes are scattered over. 1 = anywhere; 0.3 = all tribes start within a region about a third of the map across, so predators and prey share a landscape from day one.',
  founderEnergy: 'Energy the starting tribes (and air-drops and immigrants) arrive with, as a fraction of their maximum.',
  leanPredators: 'When a starting tribe (or newcomer) happens to be meat-eating, pull its upkeep genes (size, lifespan, stamina, memory, smell) this far toward moderate values. 0 = fully random founders; 1 = all set to moderate. Gives predators a body they can afford to feed; evolution takes over from there.',
  maxPop: 'Hard population cap: at the cap, breeding is blocked. Keeps the browser responsive.',
  chartWindow: 'How far back the charts look. The default 30,000 ticks is 5 years at the default season length. 0 = keep the whole run (older history is stored at a coarser resolution as the run grows). Lowering it discards older history for good.',
};

const P = {};
for (const d of PARAM_DEFS) P[d[1]] = d[6];

// Add sliders from another file (events, future systems). Call at load time, before ui.js builds the panel.
// rows use the PARAM_DEFS format; tips map key -> hover text. Sets P defaults (keeps a value that is already set).
// Rows with the same section name are grouped under one heading wherever they were added.
function addParams(rows, tips) {
  for (const r of rows) { PARAM_DEFS.push(r); if (!(r[1] in P)) P[r[1]] = r[6]; }
  Object.assign(PARAM_TIPS, tips || {});
}

// ---- Systems registry: world upkeep that runs on a fixed schedule inside Sim.step ----
// registerSystem({ name, every, phase, update(tick), reset(), save(), load(o) }); only name and update are required.
//   every  run when tick % every === 0 (default 1 = every tick)
//   phase  'pre' (default): after wild-food spawning and food rot, before immigration;
//          'post': after immigration, before the simlets move
//   reset  called by Sim.reset (new world / restart / before a load)
//   save / load  optional: Save.serialize stores save()'s plain-JSON result under o.systems[name], and
//          Save.restore hands it back to load() after everything else is restored
// Systems run in registration order (= script load order), which is part of the deterministic tick.
const Systems = [];
function registerSystem(sys) {
  if (Systems.some(s => s.name === sys.name)) throw new Error('System registered twice: ' + sys.name);
  Systems.push(Object.assign({ every: 1, phase: 'pre' }, sys));
}
function runSystems(phase, tick) {
  for (let i = 0; i < Systems.length; i++) {
    const s = Systems[i];
    if (s.phase === phase && tick % s.every === 0) s.update(tick);
  }
}

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function gauss() {   // standard normal (Box-Muller)
  let u = 0; while (u === 0) u = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
}
function wrapAngle(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }
